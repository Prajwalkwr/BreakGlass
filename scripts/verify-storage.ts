/**
 * End-to-end verification of the evidence path with S3-compatible storage.
 *
 *   S3_ENDPOINT=... S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
 *   API_BASE=http://127.0.0.1:4010 npx tsx scripts/verify-storage.ts
 *
 * The API and worker under test must be running with STORAGE_DRIVER=s3 and the
 * same S3 settings. This script then:
 *
 *   1. starts a local site whose page is missing the element the check asserts,
 *   2. creates a real browser check, lets the scheduler+worker run it,
 *   3. proves a screenshot landed in the *bucket* (not on local disk),
 *   4. downloads it through the signed, session-authenticated API URL,
 *   5. proves a different workspace cannot read that evidence,
 *   6. proves expired evidence is refused.
 */
import http from 'node:http';
import { HeadObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import mongoose from 'mongoose';

const API = process.env.API_BASE ?? 'http://127.0.0.1:4000';
const ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:5173';
const TARGET_PORT = 9921;

const S3 = {
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9100',
  bucket: process.env.S3_BUCKET ?? 'breakglass-evidence',
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'test',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'test',
  prefix: process.env.S3_PREFIX ?? '',
};

const results: { name: string; ok: boolean; detail?: string }[] = [];
function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

let cookie = '';
async function api(path: string, options: { method?: string; body?: unknown; cookieValue?: string } = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(options.cookieValue ?? cookie ? { cookie: options.cookieValue ?? cookie } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie && !options.cookieValue) cookie = setCookie.split(';')[0];
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, body: json, contentType: response.headers.get('content-type') ?? '' };
}

function startTarget() {
  // A page that renders, but without the element the check requires — this is
  // a real, non-crashing website failure that must produce evidence.
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body><h1>Checkout</h1><p id="status">Processing</p></body></html>');
  });
  return new Promise<http.Server>((resolve) => server.listen(TARGET_PORT, '127.0.0.1', () => resolve(server)));
}

const s3 = new S3Client({
  endpoint: S3.endpoint,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: S3.accessKeyId, secretAccessKey: S3.secretAccessKey },
});

async function main() {
  const stamp = Date.now();
  const target = await startTarget();

  try {
    const register = await api('/auth/register', {
      method: 'POST',
      body: {
        name: 'Storage Verifier',
        email: `storage-${stamp}@example.com`,
        password: 'correct-horse-battery-1',
        workspaceName: 'Storage Verify',
      },
    });
    const workspaceId = register.body?.workspaces?.[0]?.id;
    record('account + workspace created', register.status === 201 && Boolean(workspaceId), `HTTP ${register.status}`);

    const project = await api(`/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      body: { name: 'Evidence Target', url: `http://127.0.0.1:${TARGET_PORT}/checkout` },
    });
    const projectId = project.body?.project?.id;
    record('project created', project.status === 201, `HTTP ${project.status}`);

    const created = await api(`/workspaces/${workspaceId}/projects/${projectId}/checks`, {
      method: 'POST',
      body: {
        name: 'Checkout confirmation appears',
        type: 'browser',
        intervalSeconds: 300,
        timeoutMs: 30000,
        failureThreshold: 1,
        recoveryThreshold: 2,
        severity: 'major',
        enabled: true,
        config: {
          startUrl: `http://127.0.0.1:${TARGET_PORT}/checkout`,
          steps: [{ type: 'expectText', value: 'Order confirmed' }],
          captureScreenshotOnFailure: true,
          captureTraceOnFailure: false,
        },
      },
    });
    const checkId = created.body?.check?.id;
    record('browser check created and scheduled', created.status === 201 && Boolean(created.body?.check?.nextRunAt), `HTTP ${created.status}`);

    // Let the scheduler + worker pick it up.
    let run: any = null;
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline) {
      const detail = await api(`/workspaces/${workspaceId}/projects/${projectId}`);
      const runs = detail.body?.recentRuns ?? [];
      run = runs.find((item: any) => item.checkId === checkId);
      if (run && run.artifacts?.length) break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    record('scheduler ran the check without the browser', Boolean(run), run ? `run ${String(run._id ?? run.id)}` : 'no run appeared');
    record('the run recorded a real failure with a reason', run?.success === false && Boolean(run?.failureCategory), `category=${run?.failureCategory}`);
    record('screenshot evidence was attached to the run', (run?.artifacts?.length ?? 0) > 0, `${run?.artifacts?.length ?? 0} artifact(s)`);

    if (!run?.artifacts?.length) {
      throw new Error('No evidence was produced; cannot verify storage.');
    }

    const listed = await api(`/workspaces/${workspaceId}/artifacts?runId=${encodeURIComponent(run.runId)}`);
    const evidence = listed.body?.artifacts?.[0];
    record('evidence is listed to its own workspace', Boolean(evidence?.url), `${listed.body?.artifacts?.length ?? 0} item(s)`);

    // Where the record says the bytes live (the API deliberately does not
    // expose storage internals to the client, so this is read from Mongo).
    await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/breakglass');
    const artifactDoc = await mongoose.connection
      .collection('artifacts')
      .findOne({ _id: new mongoose.Types.ObjectId(evidence.id) });
    record(
      'artifact record reports S3 as the storage backend',
      artifactDoc?.storage === 's3',
      `storage=${artifactDoc?.storage} key=${artifactDoc?.storageKey}`,
    );

    const storageKey = artifactDoc?.storageKey as string;
    const bucketKey = S3.prefix ? `${S3.prefix.replace(/\/+$/, '')}/${storageKey}` : storageKey;
    let bucketHead: any = null;
    try {
      bucketHead = await s3.send(new HeadObjectCommand({ Bucket: S3.bucket, Key: bucketKey }));
    } catch (error) {
      record('object exists in the private bucket', false, (error as Error).message);
    }
    record(
      'object exists in the private bucket',
      Boolean(bucketHead),
      bucketHead ? `${bucketHead.ContentLength} bytes, ${bucketHead.ServerSideEncryption ?? 'no-sse'}` : undefined,
    );

    const object = await s3.send(new GetObjectCommand({ Bucket: S3.bucket, Key: bucketKey }));
    const stored = Buffer.from(await object.Body!.transformToByteArray());
    record('stored object is a JPEG screenshot', stored.subarray(0, 2).toString('hex') === 'ffd8', `${stored.length} bytes`);

    const url = evidence.url as string;
    record('a short-lived signed URL is issued', Boolean(url) && url.includes('sig='), url ? url.slice(0, 42) + '…' : undefined);

    const fetched = await fetch(`${API}${url}`, { headers: { origin: ORIGIN, cookie } });
    const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
    record(
      'API streams the exact stored bytes over the signed URL',
      fetched.status === 200 && fetchedBytes.equals(stored),
      `HTTP ${fetched.status}, ${fetchedBytes.length} bytes`,
    );

    const unsigned = await fetch(`${API}${url.split('&sig=')[0]}`, { headers: { origin: ORIGIN, cookie } });
    record('the same URL without a valid signature is refused', unsigned.status === 403 || unsigned.status === 400, `HTTP ${unsigned.status}`);

    // Tenant isolation: a different workspace must not be able to read it.
    const outsider = await fetch(`${API}${url}`, { headers: { origin: ORIGIN } });
    record('anonymous read of the signed URL is refused', outsider.status === 401 || outsider.status === 403, `HTTP ${outsider.status}`);

    const otherCookieBefore = cookie;
    const otherRegister = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({
        name: 'Outsider',
        email: `outsider-${stamp}@example.com`,
        password: 'correct-horse-battery-1',
        workspaceName: 'Other Agency',
      }),
    });
    const otherCookie = (otherRegister.headers.get('set-cookie') ?? '').split(';')[0];
    const otherWorkspace = (await otherRegister.json())?.workspaces?.[0]?.id;
    cookie = otherCookieBefore;
    const crossTenant = await fetch(`${API}${url}`, { headers: { origin: ORIGIN, cookie: otherCookie } });
    record('another workspace cannot read the evidence', crossTenant.status === 404 || crossTenant.status === 403, `HTTP ${crossTenant.status}`);
    const crossList = await fetch(`${API}/workspaces/${otherWorkspace}/artifacts?runId=${encodeURIComponent(run.runId)}`, {
      headers: { origin: ORIGIN, cookie: otherCookie },
    });
    const crossBody = await crossList.json().catch(() => ({}));
    record(
      'another workspace cannot list this run evidence',
      crossList.status === 404 || (crossBody?.artifacts?.length ?? 0) === 0,
      `HTTP ${crossList.status}`,
    );

    // Expiry: retention deletes the record and the object; until then the
    // download path must refuse an expired artifact even with a valid signature.
    await mongoose.connection
      .collection('artifacts')
      .updateOne({ _id: new mongoose.Types.ObjectId(evidence.id) }, { $set: { expiresAt: new Date(Date.now() - 60_000) } });
    const expiredRead = await fetch(`${API}${url}`, { headers: { origin: ORIGIN, cookie } });
    record('expired evidence is refused', expiredRead.status === 404, `HTTP ${expiredRead.status}`);
    await mongoose.connection
      .collection('artifacts')
      .updateOne({ _id: new mongoose.Types.ObjectId(evidence.id) }, { $set: { expiresAt: new Date(Date.now() + 86_400_000) } });
  } finally {
    target.close();
    await mongoose.disconnect().catch(() => undefined);
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} storage assertions passed\n`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
