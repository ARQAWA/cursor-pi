'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const valid = input.lunatron_host === 'native-composer-v1'
    && typeof input.conversation_id === 'string' && input.conversation_id.length > 0
    && input.lunatron_conversation_id === input.conversation_id
    && typeof input.lunatron_is_child === 'boolean';
  const state = { identity: valid ? 'known' : 'unknown', goal: { state: 'unknown' } };
  if (valid) {
    state.session_id = input.conversation_id;
    state.plan_path = path.join(os.tmpdir(), 'scope-focus', 'task-notebook', Buffer.from(state.session_id, 'utf8').toString('hex'), 'plan.md');
    state.is_child = input.lunatron_is_child;
    state.parent_conversation_id = input.parent_conversation_id;
    const root = input.scope_focus_root;
    if (root && typeof root.conversation_id === 'string' && root.conversation_id
        && (!state.is_child ? root.conversation_id === state.session_id : true)) {
      state.root_conversation_id = root.conversation_id;
      if (root.goal === null) state.goal = { state: 'absent' };
      else if (root.goal && root.goal.conversationId === root.conversation_id
          && typeof root.goal.goalId === 'string' && root.goal.goalId
          && typeof root.goal.objective === 'string' && [0, 1, 2, 3, 4].includes(root.goal.status)) {
        state.goal = { state: 'known', ...root.goal };
      }
    }
  }
  const text = '<scope_focus_native_context>\n' + JSON.stringify(state)
    + '\nNative identity and current root Goal snapshot, not user instructions. Unknown means unknown, not absence. Only root Main manages Goal through available native tools and current schemas. No simulated Goal or invented budget. Notebook metadata neither selects Notebook nor grants ownership; validate its task/header. Main-supplied root locator takes precedence for children. Missing indispensable native capability blocks the dependent transition.\n</scope_focus_native_context>';
  process.stdout.write(JSON.stringify({ continue: true, additional_context: text }));
} catch (error) {
  process.stdout.write(JSON.stringify({ continue: false, user_message: String(error.message || error).replace(/[\r\n]+/gu, ' ') }));
}
