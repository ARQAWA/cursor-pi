import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { capturedCursorUseInstructions } from "../../dynamic/captured-instructions.ts";
import { FIRST_PARTY_NAMESPACE, registerDynamicNamespace } from "../../dynamic/registry.ts";
import { register as registerCreateGoal } from "./create-goal.ts";
import { register as registerAwaitShell } from "./await-shell.ts";
import { register as registerDelete } from "./delete.ts";
import { register as registerEditNotebook } from "./edit-notebook.ts";
import { register as registerTodoWrite } from "./todo-write.ts";
import { register as registerUpdateGoal } from "./update-goal.ts";

// Registers the cursor namespace's use-instructions header and each Cursor-run namespace tool built so far.
export function registerCursorNamespace(pi: ExtensionAPI): void {
	registerDynamicNamespace(FIRST_PARTY_NAMESPACE, capturedCursorUseInstructions());
	registerTodoWrite(pi);
	registerAwaitShell();
	registerDelete();
	registerEditNotebook(pi);
	registerCreateGoal(pi);
	registerUpdateGoal(pi);
}
