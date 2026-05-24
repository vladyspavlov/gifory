export const en = {
  select_scope:        "Select an active community via /scopes.",
  no_scope_for_gifs:   "Select an active community via /scopes to add GIFs.",
  no_scope_for_tags:   "Select an active community via /scopes to browse tags.",
  no_scope_for_stats:  "Select an active community via /scopes to view statistics.",

  gif_already_exists:  "📌 GIF already in the database!\n🏷 Tags: {tags}\n😀 Emojis: {emojis}",
  gif_btn_replace_all: "🔄 Replace all",
  gif_btn_add_new:     "➕ Add new",
  gif_btn_no:          "❌ No",
  gif_btn_cancel:      "❌ Cancel",
  gif_enter_tags:      "🏷 Enter tags and/or emojis for this GIF:",

  gif_saved:           "✅ Saved!\n🏷 Tags: {tags}\n😀 Emojis: {emojis}",
  gif_not_found:       "This GIF was not found in this community's database.",

  changes_cancelled:   "🚫 Changes cancelled.",
  operation_cancelled: "🚫 Operation cancelled.",
  enter_new_tags:      "✏️ Enter new tags and emojis (existing ones will be fully replaced):",
  enter_append_tags:   "➕ Enter tags and emojis to append to existing ones:",

  reply_to_delete: "Reply to a GIF you want to delete.",
  reply_to_edit:   "Reply to a GIF whose tags you want to change.",
  no_tags_found:   "No tags or emojis found.\nFormat: /edit #tag1 #tag2 😀",

  tags_empty:       "📂 Tag catalog is empty.",
  tags_catalog:     "📂 Tag catalog ({count} items) — page {page}/{total}:",
  tags_btn_back:    "⬅️ Back",
  tags_btn_forward: "Forward ➡️",

  backup_creating: "⏳ Creating backup…",
  backup_caption:  "📦 Manual backup — {scopeName}\n🗂 GIFs: {count}",
  backup_error:    "❌ Error while creating backup.",

  create_private_only: "/create is only available in private messages.",
  create_needs_name:   "Specify a community name: /create MyCommunity",
  create_success:
    "✅ Community \"{name}\" created!\n\n" +
    "Send GIFs to this chat to add them to the archive — include #tags in the caption or enter them when prompted.\n\n" +
    "• /invite — invite members\n" +
    "• /backup — save a backup",

  join_needs_token:  "Specify invite token: /join <token>",
  join_invalid:      "❌ Invalid or expired token.",
  join_success:      "✅ You joined \"{name}\"!\nYou can now search their GIFs from any chat.",

  invite_needs_scope:  "First select an active community via /scopes or use the command in a group.",
  invite_not_found:    "Community not found.",
  invite_group_scope:  "Group communities don't need invites — just add the bot to the group.",
  invite_admin_only:   "Only admins can create invites.",
  invite_link:         "🔗 Invite to \"{name}\":\n\n{link}\n\n⏳ Valid for 24 hours.",

  scopes_none:          "You have no communities yet.\n\n• /create <name> — create your own\n• Or ask an admin for an invite link",
  scopes_header_active: "📋 Your communities (active: {name}):",
  scopes_header:        "📋 Your communities — tap one to activate:",
  scope_set_active:     "✅ Active community: {name}",
  scope_set:            "✅ Community selected.",

  start_welcome:
    "👋 Welcome to Gifory — a GIF archive for your community.\n\n" +
    "📌 How it works:\n" +
    "• Admins add GIFs with #tags to the community archive\n" +
    "• Everyone searches instantly via @giforybot in any chat\n\n" +
    "🚀 Get started:\n" +
    "• Got an invite? Tap \"🔍 Use these GIFs\" on any Gifory GIF\n" +
    "• Starting fresh? /create <name> — build your own collection\n\n" +
    "/help — all commands",

  help:
    "👋 Gifory — GIF archive for your community.\n\n" +
    "🔍 Search: type @giforybot [query] in any chat\n\n" +
    "📋 Communities\n" +
    "/scopes — your communities, set active\n" +
    "/create <name> — create a new community\n" +
    "/join <token> — join via invite link\n\n" +
    "🏷 Browse\n" +
    "/tags — tag catalog (tap a tag to search)\n\n" +
    "🌐 Settings\n" +
    "/lang — change language\n" +
    "/help — this message\n\n" +
    "⚙️ Admin commands\n" +
    "[send GIF] — add to archive (#tags in caption, or enter after)\n" +
    "[reply GIF → GIF] — replace file, keep tags\n" +
    "/edit #tags 😀 — (reply to GIF) replace all tags\n" +
    "/del — (reply to GIF) delete GIF\n" +
    "/invite — generate invite link for your community\n" +
    "/backup — download full archive as JSON\n" +
    "/stats — top-5 GIFs all-time and this week\n" +
    "/members — list community members\n" +
    "/kick <userId> — remove a member\n" +
    "/promote <userId> — promote a member to admin\n" +
    "/rename <name> — rename the community\n" +
    "/syncadmins — re-sync group admins (group only)",

  syncadmins_success: "✅ Admins synced ({count} people).",
  syncadmins_error:   "❌ Failed to get admin list.",

  broadcast_new_gif: "🆕 New GIF added!",
  broadcast_tags:    "🏷 Tags: {tags}",
  broadcast_emojis:  "😀 Emojis: {emojis}",

  no_permissions: "You don't have permission to add or edit GIFs. You can only search.",

  join_community:   "Join a community",
  inline_join_btn:  "🔍 Use these GIFs",

  lang_select: "🌐 Select language:",
  lang_set:    "✅ Language set.",

  btn_search:        "🔍 Search",
  btn_tags:          "🏷 Tags",
  btn_communities:   "📋 Communities",
  btn_help:          "❓ Help",
  btn_lang:          "🌐 Language",
  btn_search_gifs:   "🔍 Search GIFs",
  search_prompt:     "Tap the button below to search GIFs in this chat:",
  btn_search_inline: "🔍 Search GIFs…",

  members_header:     "👥 Members of \"{name}\" ({count} total):",
  members_admins:     "⭐ Admins:",
  members_users:      "👤 Members:",
  members_empty:      "👥 No members tracked yet.",
  members_group_note: "(Group community: only members who have sent a message are listed.)",

  kick_usage:       "Reply to a message from the user, or: /kick <userId>",
  kick_self:        "You cannot remove yourself from the community.",
  kick_not_member:  "This user is not a member of this community.",
  kick_success:     "✅ {user} removed from the community. All pending invite links have been revoked.",
  kick_manual_only: "Member removal is only available for private communities.",

  promote_usage:         "Reply to a message from the user, or: /promote <userId>",
  promote_self:          "You are already an admin.",
  promote_not_member:    "This user is not a member of this community.",
  promote_already_admin: "This user is already an admin.",
  promote_success:       "✅ {user} is now an admin.",
  promote_manual_only:   "Admin promotion is only available for private communities. Use /syncadmins for group communities.",

  rename_usage:   "Usage: /rename <new name>",
  rename_success: "✅ Community renamed to \"{name}\".",

  stats_header:       "📊 Statistics for \"{name}\":",
  stats_empty:        "📊 No usage statistics yet.",
  stats_total_header: "🏆 Top {count} all-time:",
  stats_week_header:  "📅 Top {count} this week:",
  stats_item:         "{rank}. {tags} — {count}×",
};

export type Messages = typeof en;
