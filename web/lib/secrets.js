// ---------------------------------------------------------------------------
// Secret resolution — SSM Parameter Store SecureStrings, cached per cold start.
// Keys are NEVER baked into the image, the repo, or plaintext env vars in prod;
// only the SSM parameter *name* travels in the Lambda environment.
// ---------------------------------------------------------------------------
const cache = new Map();

export async function getSecret(paramName) {
  if (!paramName) return "";
  if (cache.has(paramName)) return cache.get(paramName);
  try {
    // @aws-sdk/client-ssm ships in the Lambda Node runtime; imported lazily so
    // local/container runs that use plain env vars never need the dependency.
    const { SSMClient, GetParameterCommand } = await import("@aws-sdk/client-ssm");
    const ssm = new SSMClient({});
    const out = await ssm.send(new GetParameterCommand({ Name: paramName, WithDecryption: true }));
    const val = out.Parameter?.Value || "";
    cache.set(paramName, val);
    return val;
  } catch (err) {
    console.error(`getSecret(${paramName}) failed:`, err.message);
    return "";
  }
}
