import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { config } from "../config.js";

let ses;
export async function sendOtpEmail(to, code) {
  if (!config.sesFrom) throw new Error("SES_FROM is not configured");
  ses ??= new SESv2Client({ region: process.env.AWS_REGION });
  await ses.send(new SendEmailCommand({
    FromEmailAddress: config.sesFrom,
    Destination: { ToAddresses: [to] },
    Content: { Simple: {
      Subject: { Data: `Your Echoly sign-in code: ${code}` },
      Body: { Text: { Data: `Your sign-in code is ${code}. It expires in 10 minutes.\n\nIf you did not request it, ignore this email.` } },
    } },
  }));
}
