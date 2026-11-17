import { App } from "aws-cdk-lib";
import { EcholyStack } from "../lib/stack.js";

const app = new App();
new EcholyStack(app, "EcholyStack", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  adminEmail: app.node.tryGetContext("adminEmail") ?? "unset@example.com",
  cloudFrontPrefixList: app.node.tryGetContext("cfPrefixList") ?? "pl-00000000",
});
