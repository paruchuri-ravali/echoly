import { Stack, Duration, RemovalPolicy, CfnOutput, Fn } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ses from "aws-cdk-lib/aws-ses";
import * as logs from "aws-cdk-lib/aws-logs";

export class EcholyStack extends Stack {
  constructor(scope, id, { adminEmail, cloudFrontPrefixList, ...props }) {
    super(scope, id, props);

    // No NAT gateway (cost): API tasks run in public subnets, the database in isolated subnets.
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2, natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "db", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    const db = new rds.DatabaseInstance(this, "Db", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc, vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      databaseName: "echoly", credentials: rds.Credentials.fromGeneratedSecret("echoly_admin"),
      allocatedStorage: 20, storageType: rds.StorageType.GP3, storageEncrypted: true,
      backupRetention: Duration.days(1), deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY, // practice environment
    });

    // SES: creating the identity makes AWS email a verification link to the admin address.
    new ses.EmailIdentity(this, "SenderIdentity", { identity: ses.Identity.email(adminEmail) });

    const cluster = new ecs.Cluster(this, "Cluster", { vpc });
    const api = new patterns.ApplicationLoadBalancedFargateService(this, "Api", {
      cluster, cpu: 256, memoryLimitMiB: 512, desiredCount: 1,
      assignPublicIp: true, taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      publicLoadBalancer: true, openListener: false, listenerPort: 80,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset("../server"),
        containerPort: 8787,
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: "api", logRetention: logs.RetentionDays.ONE_WEEK }),
        environment: {
          NODE_ENV: "production", DEMO_MODE: "true", PORT: "8787", RUN_MIGRATIONS: "true",
          BOOTSTRAP_ADMIN_EMAIL: adminEmail, SES_FROM: adminEmail,
          DB_SECRET_ARN: db.secret.secretArn, DB_SSL: "true",
        },
      },
    });
    api.targetGroup.configureHealthCheck({ path: "/healthz", interval: Duration.seconds(30) });
    db.secret.grantRead(api.taskDefinition.taskRole);
    db.connections.allowDefaultPortFrom(api.service, "API to Postgres");
    api.taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ["ses:SendEmail"], resources: ["*"] }));
    // Only CloudFront may reach the load balancer.
    api.loadBalancer.connections.allowFrom(ec2.Peer.prefixList(cloudFrontPrefixList), ec2.Port.tcp(80), "CloudFront only");

    const site = new s3.Bucket(this, "Site", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY, autoDeleteObjects: true,
    });

    // SPA fallback only for the static site (not the API): rewrite extension-less paths to /index.html.
    const spaRewrite = new cf.Function(this, "SpaRewrite", {
      runtime: cf.FunctionRuntime.JS_2_0,
      code: cf.FunctionCode.fromInline(`function handler(event){var r=event.request;if(r.uri.indexOf('.')===-1){r.uri='/index.html';}return r;}`),
    });

    const apiOrigin = new origins.HttpOrigin(api.loadBalancer.loadBalancerDnsName, { protocolPolicy: cf.OriginProtocolPolicy.HTTP_ONLY });
    const apiBehavior = {
      origin: apiOrigin, viewerProtocolPolicy: cf.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cf.AllowedMethods.ALLOW_ALL, cachePolicy: cf.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    };
    const dist = new cf.Distribution(this, "Cdn", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [{ function: spaRewrite, eventType: cf.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: { "/internal/*": apiBehavior, "/v1/*": apiBehavior, "/healthz": apiBehavior },
    });

    new s3deploy.BucketDeployment(this, "DeploySite", {
      sources: [s3deploy.Source.asset("../web/dist")], destinationBucket: site, distribution: dist, distributionPaths: ["/*"],
    });

    new CfnOutput(this, "AppUrl", { value: `https://${dist.distributionDomainName}` });
    new CfnOutput(this, "AdminEmail", { value: adminEmail });
  }
}
