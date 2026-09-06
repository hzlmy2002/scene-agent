// Tests and their subprocesses must never use the developer's real credentials.
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const home = mkdtempSync(path.join(tmpdir(), 'aisa-test-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.AISA_API_KEY;
delete process.env.AISA_AUTH_FILE;
process.on('exit', () => rmSync(home, {recursive: true, force: true}));
