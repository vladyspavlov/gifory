import { MyContext } from "../session.js";
import { renameScope } from "../scopes.js";

export async function onRename(ctx: MyContext): Promise<void> {
  const scopeId = ctx.currentScopeId;
  if (!scopeId) {
    await ctx.reply(ctx.t("select_scope"));
    return;
  }

  const text = ctx.message?.text ?? "";
  const newName = text.replace(/^\/rename\s*/i, "").trim();

  if (!newName) {
    await ctx.reply(ctx.t("rename_usage"));
    return;
  }

  await renameScope(scopeId, newName);
  await ctx.reply(ctx.t("rename_success", { name: newName }));
}
