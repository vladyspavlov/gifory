import { MyContext } from "../session.js";
import { renameScope } from "../scopes.js";
import { MAX_SCOPE_NAME_LENGTH } from "./onCreateScope.js";
import { promptScopeSelect } from "./onScopes.js";

export async function onRename(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await promptScopeSelect(ctx);
    return;
  }

  const text = ctx.message?.text ?? "";
  const newName = text.replace(/^\/rename\s*/i, "").trim();

  if (!newName) {
    await ctx.reply(ctx.t("rename_usage"));
    return;
  }

  if (newName.length > MAX_SCOPE_NAME_LENGTH) {
    await ctx.reply(ctx.t("scope_name_too_long", { max: MAX_SCOPE_NAME_LENGTH }));
    return;
  }

  if (!(await renameScope(scopeId, newName, ctx.from!.id))) {
    await ctx.reply(ctx.t("scope_gone"));
    return;
  }
  await ctx.reply(ctx.t("rename_success", { name: newName }));
}
