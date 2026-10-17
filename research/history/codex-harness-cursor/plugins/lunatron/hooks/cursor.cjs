'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyModeCommand, contextFor } = require('./lunatron.cjs');

function cursorContext(context) {
  return context
    .replaceAll('lunatron_luna_xhigh', 'lunatron-luna-xhigh')
    .replaceAll('lunatron_sol_low', 'lunatron-sol-low')
    .replaceAll('lunatron_sol_medium', 'lunatron-sol-medium')
    .replaceAll('lunatron_sol_xhigh', 'lunatron-sol-xhigh')
    .replaceAll('agent_type=', 'subagent_type=')
    .replaceAll('with a configured target of 44 excluding Main.', "within Cursor's actual native limits.")
    .replaceAll('with configured target 44 excluding Main.', "within Cursor's actual native limits.")
    .replaceAll('config 44 does not prove live capacity', 'configuration does not prove live capacity')
    + '\n\nLUNATRON_HOST=CURSOR\nUse the available native Task/subagent tools and their current schemas. The named worker profiles use the native full parent fork through this harness; Luntik starts with only its assignment and selected sources and is resumed for later questions. Do not request a clean replacement for a required full fork. Native Cursor capacity and nesting limits apply; the Codex target 44 is not a Cursor setting or capacity claim. An unavailable required role, model pair, fork or slot stops its dependent block. Wait through native completion/events; do not poll transcripts. LNT0 stops this root\'s linked child trees through native stopSubagentTree before continuation; establish interrupted changes. This binding exposes no agent-close tool: final, wait and stop do not prove closure or an open-slot release. Use native close only when actually available and acknowledged; otherwise report the limitation. This host context and any earlier root commands are not child assignments.';
}

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (!input || input.hook_event_name !== 'beforeSubmitPrompt'
      || input.lunatron_host !== 'native-composer-v1'
      || typeof input.conversation_id !== 'string' || !input.conversation_id
      || input.lunatron_conversation_id !== input.conversation_id
      || typeof input.lunatron_is_child !== 'boolean') {
    throw new Error('Native Lunatron binding is unavailable; use the compatible Cursor harness patch.');
  }
  if (input.lunatron_is_child) {
    if (typeof input.agent_id !== 'string' || !input.agent_id
        || typeof input.agent_type !== 'string' || !input.agent_type) {
      throw new Error('Native Lunatron child identity is incomplete.');
    }
  } else if (input.agent_id !== undefined || input.agent_type !== undefined) {
    throw new Error('Native Lunatron root identity conflicts with child metadata.');
  }
  process.env.PLUGIN_DATA ||= path.join(os.homedir(), '.cursor', 'lunatron');
  const nativeInput = { ...input, session_id: input.conversation_id };
  const command = input.scope_focus_context_refresh === true ? null : applyModeCommand(nativeInput);
  if (command?.error) throw new Error(`Команда ${command.command} не применена: ${command.error}`);
  process.stdout.write(JSON.stringify({
    continue: true,
    additional_context: '<lunatron_context>\n' + cursorContext(contextFor(nativeInput, command)) + '\n</lunatron_context>',
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    continue: false,
    user_message: String(error.message || error).replace(/[\r\n]+/gu, ' '),
  }));
}
