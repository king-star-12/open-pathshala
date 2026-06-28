// AWS Lambda entry point — wraps the Express app for a Lambda Function URL
// (API Gateway v2 / Function URL payload format 2.0). Used by the serverless
// deploy in deploy/aws. For containers (App Runner / Docker) use server.js.
import serverlessHttp from "serverless-http";
import { app } from "./server.js";

export const handler = serverlessHttp(app);
