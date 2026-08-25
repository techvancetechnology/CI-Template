import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflowPath = new URL('../.github/workflows/nextjs-pnpm-workspace-standalone-soft-deploy.yml', import.meta.url);
const workflow = readFileSync(workflowPath, 'utf8');

function stageRun(source) {
  const start = source.indexOf('      - name: Stage standalone artifact');
  const end = source.indexOf('      - name: Configure SSH transport', start);
  assert.notEqual(start, -1, 'stage artifact step must exist');
  assert.notEqual(end, -1, 'stage artifact step must end before SSH setup');
  return source.slice(start, end);
}

function migrationRun(source) {
  const start = source.indexOf('      - name: Run explicitly configured migration service');
  const end = source.indexOf('      - name: Restart service and verify health', start);
  assert.notEqual(start, -1, 'migration service step must exist');
  assert.notEqual(end, -1, 'migration service step must precede service health');
  return source.slice(start, end);
}

test('keeps an optional, environment-bound migration workspace input', () => {
  assert.match(workflow, /migration_workspace_dir:\n\s+required: false\n\s+type: string\n\s+default: ''/);
  const stage = stageRun(workflow);
  assert.match(stage, /MIGRATION_WORKSPACE_DIR: \$\{\{ inputs\.migration_workspace_dir \}\}/);
  const runBody = stage.slice(stage.indexOf('        run: |'));
  assert.doesNotMatch(runBody, /inputs\.migration_workspace_dir/);
});

test('fails closed before staging a migration workspace outside the artifact roots', () => {
  const stage = stageRun(workflow);
  for (const requiredFragment of [
    "grep -Eq '^[A-Za-z0-9][A-Za-z0-9._/-]*$'",
    '*"/../"*|*"/./"*',
    'realpath -e "$GITHUB_WORKSPACE/$MIGRATION_WORKSPACE_DIR"',
    'realpath -m "$publish/$MIGRATION_WORKSPACE_DIR"',
    '"$GITHUB_WORKSPACE"/*)',
    '"$publish"/*)',
    'test -d "$migration_source"',
    'cp -R "$migration_source" "$migration_destination"',
  ]) {
    assert.ok(stage.includes(requiredFragment), `missing fail-closed control: ${requiredFragment}`);
  }
});

test('restarts a validated configured migration service instead of falsely starting an active oneshot', () => {
  const migration = migrationRun(workflow);
  assert.match(migration, /MIGRATE_SERVICE_NAME: \$\{\{ inputs\.migrate_service_name \}\}/);
  assert.match(migration, /grep -Eq '\^\[A-Za-z0-9\]\[A-Za-z0-9_\.@-\]\*\\\.service\$'/);
  assert.match(migration, /sudo systemctl restart '\$MIGRATE_SERVICE_NAME'/);
  assert.doesNotMatch(migration, /sudo systemctl start/);

  const regressed = workflow.replace("sudo systemctl restart '$MIGRATE_SERVICE_NAME'", "sudo systemctl start '$MIGRATE_SERVICE_NAME'");
  assert.doesNotMatch(migrationRun(regressed), /sudo systemctl restart/);
});
