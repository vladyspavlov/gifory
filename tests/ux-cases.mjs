import assert from 'node:assert/strict';
import { GrammyError } from 'grammy';
import { onHome, onSearch, onResume, onCancel } from '../dist/src/handlers/onHome.js';
import { showCommunity, onScopes, onScopePickCallback } from '../dist/src/handlers/onScopes.js';
import { onAnimation, onAdd } from '../dist/src/handlers/onAnimation.js';
import { onText } from '../dist/src/handlers/onText.js';
import { onTags, onTagsPageCallback } from '../dist/src/handlers/onTags.js';
import { onInline } from '../dist/src/handlers/onInline.js';
import { onKeyboardButton } from '../dist/src/handlers/onKeyboardButton.js';
import { onNavigation } from '../dist/src/handlers/onNavigation.js';
import { onCreateScope } from '../dist/src/handlers/onCreateScope.js';
import { onRename } from '../dist/src/handlers/onRename.js';
import { onDelete } from '../dist/src/handlers/onDelete.js';
import { onInvite } from '../dist/src/handlers/onInvite.js';
import { onDirectJoinScope, onJoinScope } from '../dist/src/handlers/onJoinScope.js';
import { askConfirmation, onConfirmCallback, previewGif, showArchive } from '../dist/src/handlers/onManagement.js';
import { onMemberCallback } from '../dist/src/handlers/onMembers.js';
import { onLangSetCallback } from '../dist/src/handlers/onLang.js';
import { onMyChatMember } from '../dist/src/handlers/onMyChatMember.js';
import { onBackup } from '../dist/src/handlers/onBackup.js';
import { onStats } from '../dist/src/handlers/onStats.js';
import { broadcastNewGif } from '../dist/src/broadcast.js';
import { getScopeAccess, getAccessibleScopes, ScopeVerificationError } from '../dist/src/access.js';
import { t } from '../dist/src/i18n/index.js';
import { gifHandle, FLOW_TTL, replyScope } from '../dist/src/ui.js';

const buttons = value => value?.options?.reply_markup?.inline_keyboard?.flat() ?? [];
const callbacks = context => context.replies.flatMap(buttons).map(button => button.callback_data).filter(Boolean);
const text = context => context.replies.map(item => item.text ?? item.options?.caption ?? '').join('\n');
const callback = (context, data, messageId = 500) => { context.message = undefined; context.callbackQuery = { data, message: { message_id: messageId, text: 'Previous screen' } }; };
function verifyRendered(context) {
  for (const item of context.replies) {
    assert(!/\{\w+\}/.test(item.text ?? item.options?.caption ?? ''), `unresolved copy: ${item.text}`);
    for (const button of buttons(item)) if (button.callback_data) assert(Buffer.byteLength(button.callback_data) <= 64, button.callback_data);
  }
}

export async function runUxChecks(parent, { ctx, scopes, meili, redis, createBot }) {
  const make = overrides => ctx({ from: { id: 51, first_name: 'Admin' }, chat: { id: 51, type: 'private' }, currentScopeId: 'uxa', me: { id: 123456, username: 'testbot' }, ...overrides });
  await scopes.createScope('uxa', 'Friends', 'manual', [51, 52]);
  await scopes.createScope('uxb', 'Work', 'manual', [51]);
  await scopes.addUserToScope(53, 'uxa');
  await scopes.setActiveScopeId(51, 'uxa');
  await meili.upsertGif('uxshared', 'shared-a', ['#same'], ['😂'], 'uxa');
  await meili.upsertGif('uxshared', 'shared-b', ['#same'], ['😂'], 'uxb');
  await meili.upsertGif('uxonlyb', 'only-b', ['#work'], ['🎉'], 'uxb');

  await parent.test('UX: first-run, returning and role-aware community screens', async () => {
    const fresh = make({ from: { id: 54001, first_name: 'New' }, currentScopeId: undefined });
    await onHome(fresh);
    assert(callbacks(fresh).includes('nav:create'));
    assert(callbacks(fresh).includes('nav:join'));
    assert(fresh.replies.flatMap(buttons).some(button => button.url?.includes('startgroup=setup')));
    const member = make({ from: { id: 53, first_name: 'Member' } });
    await showCommunity(member, 'uxa');
    assert(!callbacks(member).includes('nav:manage:uxa'));
    assert(text(member).includes('Member'));
    const admin = make(); await onHome(admin); await showCommunity(admin, 'uxa');
    assert(callbacks(admin).includes('nav:manage:uxa'));
    assert(text(admin).includes('Private GIF changes go to: Friends'));
    assert(!text(admin).includes('Ask an admin for an invite'));
    for (const context of [fresh, member, admin]) verifyRendered(context);
  });

  await parent.test('UX: global deduplication and strict community-only inline search', async () => {
    const answers = [];
    const context = make({ inlineQuery: { query: '#same', offset: '' }, answerInlineQuery: async (results, options) => answers.push({ results, options }) });
    await onInline(context); assert.equal(answers[0].results.length, 1);
    assert(['uxa_uxshared', 'uxb_uxshared'].includes(answers[0].results[0].id));
    assert(answers[0].results[0].reply_markup.inline_keyboard[0][0].text.includes('About'));
    context.inlineQuery.query = 'in:uxa #same'; await onInline(context);
    assert(answers[1].results.every(gif => gif.id.startsWith('uxa_')));
    context.inlineQuery.query = 'in:uxb #work'; await onInline(context);
    assert.equal(answers[2].results[0].id, 'uxb_uxonlyb');
    context.inlineQuery.query = 'in:missing #same'; await onInline(context);
    assert.equal(answers[3].results.length, 0);
    assert.equal(answers[3].options.button.start_parameter, 'communities');
    context.inlineQuery.query = 'in:'; await onInline(context); assert.equal(answers[4].results.length, 0);
    context.inlineQuery.query = '#no_such_label'; await onInline(context);
    assert.equal(answers[5].results.length, 0); assert.equal(answers[5].options.button.start_parameter, 'search');
  });

  await parent.test('UX: incoming GIF survives destination selection and requires the right picker operation', async () => {
    const context = make({ currentScopeId: undefined, message: { animation: { file_unique_id: 'uxqueued', file_id: 'queued' }, caption: '#queued 😂' } });
    await onAnimation(context);
    assert.equal(context.session.pendingFileId, 'queued');
    const picker = callbacks(context).find(value => value.endsWith(':uxa') && value.startsWith('pick:'));
    const promptId = context.session.pendingSelectionMessageId;
    callback(context, picker, promptId + 1); await onScopePickCallback(context);
    assert.equal(await meili.getGifInScope('uxqueued', 'uxa'), null);
    callback(context, picker, promptId); await onScopePickCallback(context);
    assert.equal((await meili.getGifInScope('uxqueued', 'uxa')).file_id, 'queued');
    assert.equal(context.session.state, 'IDLE'); assert(text(context).includes('Saved to Friends'));
    verifyRendered(context);
  });

  await parent.test('UX: a first-time uploader can create a destination without resending the GIF', async () => {
    const context = make({ from: { id: 54002, first_name: 'Creator' }, chat: { id: 54002, type: 'private' }, currentScopeId: undefined, message: { animation: { file_unique_id: 'uxfirst', file_id: 'first-file' }, caption: '#first' } });
    await onAnimation(context); assert.equal(context.session.pendingIntent, 'add');
    callback(context, 'nav:create'); await onNavigation(context); assert.equal(context.session.state, 'WAITING_FOR_NAME');
    context.message = { text: 'My first community' }; await onText(context);
    const destination = await scopes.getActiveScopeId(54002);
    assert.equal((await meili.getGifInScope('uxfirst', destination)).file_id, 'first-file');
    assert.equal(context.session.state, 'IDLE'); verifyRendered(context);
  });

  await parent.test('UX: pending tags pause on navigation, resume in original scope and reject truncation', async () => {
    const context = make({ message: { animation: { file_unique_id: 'uxpending', file_id: 'pending' } } });
    await onAnimation(context); assert.equal(context.session.state, 'WAITING_FOR_NEW_TAGS');
    context.message = { text: t('en', 'btn_search') }; await onKeyboardButton(context, () => { throw Error('button not matched'); });
    assert.equal(context.session.paused, true);
    context.currentScopeId = 'uxb'; context.message = { text: '#wrong' }; await onText(context);
    assert.equal(await meili.getGifInScope('uxpending', 'uxa'), null);
    await onResume(context); context.message = { text: '#добрий-день' }; await onText(context);
    assert.equal(await meili.getGifInScope('uxpending', 'uxa'), null);
    let nextCalled = false;
    context.message = { text: '🏷 #радість' }; await onKeyboardButton(context, async () => { nextCalled = true; });
    assert.equal(nextCalled, true); await onText(context);
    assert.deepEqual((await meili.getGifInScope('uxpending', 'uxa')).tags, ['#радість']);
    assert.equal(await meili.getGifInScope('uxpending', 'uxb'), null);
    assert(text(context).includes('Saved to Friends')); verifyRendered(context);
  });

  await parent.test('UX: tag pages retain scope and include emoji-only labels', async () => {
    for (let i = 0; i < 14; i++) await meili.upsertGif(`uxtag${i}`, `tag${i}`, [`#tag${i}`], [], 'uxa');
    await meili.upsertGif('uxemoji', 'emoji', [], ['🥳'], 'uxa');
    const context = make(); await onTags(context);
    const page = callbacks(context).find(value => value.startsWith('tags:page:uxa:'));
    assert(page); context.currentScopeId = 'uxb'; callback(context, page); await onTagsPageCallback(context);
    assert(text(context).includes('Friends'));
    assert(context.replies.flatMap(buttons).filter(button => button.switch_inline_query_current_chat).every(button => button.switch_inline_query_current_chat.startsWith('in:uxa ')));
    assert.equal((await meili.getTagFacets('uxa'))['🥳'], 1);
    verifyRendered(context);
  });

  await parent.test('UX: archive browsing counts and paginates beyond the inline search result cap', async () => {
    await scopes.createScope('uxlarge', 'Large archive', 'manual', [60]);
    const documents = Array.from({ length: 1001 }, (_, i) => ({ id: `uxlarge_bulk${i}`, file_unique_id: `bulk${i}`, file_id: `bulk-file${i}`, scope_id: 'uxlarge', tags: ['#bulk'], emojis: [], created_at: i }));
    await meili.waitForWrite(await meili.gifIndex.addDocuments(documents));
    const first = await meili.getArchivePage('uxlarge', 0);
    assert.equal(first.total, 1001); assert.equal(first.gifs[0].id, 'uxlarge_bulk1000');
    const last = await meili.getArchivePage('uxlarge', 125);
    assert.equal(last.gifs.length, 1); assert.equal(last.gifs[0].id, 'uxlarge_bulk0');
    assert(first.gifs.every(gif => gif.scope_id === 'uxlarge'));
  });

  await parent.test('UX: destructive GIF confirmation is scoped, expiring and bound to its prompt', async () => {
    const context = make({ message: { text: '/del', reply_to_message: { animation: { file_unique_id: 'uxshared' } } } });
    await onDelete(context); assert(await meili.getGifInScope('uxshared', 'uxa'));
    let request = context.session.confirmation;
    context.currentScopeId = 'uxb'; callback(context, `confirm:yes:${request.token}`, request.messageId + 1); await onConfirmCallback(context);
    assert(await meili.getGifInScope('uxshared', 'uxa'));
    callback(context, `confirm:yes:${request.token}`, request.messageId); await onConfirmCallback(context);
    assert.equal(await meili.getGifInScope('uxshared', 'uxa'), null);
    assert(await meili.getGifInScope('uxshared', 'uxb'));
    await onConfirmCallback(context); assert.equal(context.replies.at(-1).callback.show_alert, true);
    await meili.upsertGif('uxshared', 'shared-a', ['#same'], ['😂'], 'uxa');
    const expired = make(); await askConfirmation(expired, { action: 'delete', scopeId: 'uxa', gifUniqueId: 'uxshared' });
    request = expired.session.confirmation; request.expiresAt = Date.now() - 1;
    callback(expired, `confirm:yes:${request.token}`, request.messageId); await onConfirmCallback(expired);
    assert(await meili.getGifInScope('uxshared', 'uxa')); verifyRendered(context);
  });

  await parent.test('UX: member actions confirm consequences, enforce fresh roles and protect the last admin', async () => {
    const context = make(); callback(context, 'member:open:uxa:53'); await onMemberCallback(context);
    assert(callbacks(context).includes('member:promote:uxa:53'));
    await askConfirmation(context, { action: 'promote', scopeId: 'uxa', targetId: 53 });
    assert(!(await scopes.getScope('uxa')).admin_ids.includes(53));
    const request = context.session.confirmation;
    callback(context, `confirm:yes:${request.token}`, request.messageId); await onConfirmCallback(context);
    assert((await scopes.getScope('uxa')).admin_ids.includes(53));
    const demoted = make(); await askConfirmation(demoted, { action: 'demote', scopeId: 'uxa', targetId: 53 });
    callback(demoted, `confirm:yes:${demoted.session.confirmation.token}`, demoted.session.confirmation.messageId); await onConfirmCallback(demoted);
    assert(!(await scopes.getScope('uxa')).admin_ids.includes(53));
    const stale = make(); await askConfirmation(stale, { action: 'kick', scopeId: 'uxa', targetId: 53 });
    assert(text(stale).includes('ALL unused invite links'));
    await scopes.changeAdminRole('uxa', 52, 51);
    callback(stale, `confirm:yes:${stale.session.confirmation.token}`, stale.session.confirmation.messageId); await onConfirmCallback(stale);
    assert(await scopes.isMemberOfScope(53, 'uxa'));
    await scopes.promoteToAdmin(51, 'uxa', 52);
    assert.equal(await scopes.changeAdminRole('uxb', 51, 51), false);
    const handover = make(); await askConfirmation(handover, { action: 'handover', scopeId: 'uxa', targetId: 53 });
    callback(handover, `confirm:yes:${handover.session.confirmation.token}`, handover.session.confirmation.messageId); await onConfirmCallback(handover);
    assert(!(await scopes.getScope('uxa')).admin_ids.includes(51)); assert((await scopes.getScope('uxa')).admin_ids.includes(53));
    await scopes.promoteToAdmin(51, 'uxa', 52); await scopes.changeAdminRole('uxa', 51, 53);
  });

  await parent.test('UX: archive previews use user-bound handles and source-aware replies', async () => {
    const context = make(); await showArchive(context, 'uxa');
    const open = callbacks(context).find(value => value.startsWith('archive:open:'));
    assert(open); verifyRendered(context);
    const handle = await gifHandle(context, 'uxa', 'uxshared');
    const outsider = make({ from: { id: 53 } }); callback(outsider, `archive:delete:${handle}`);
    const { onArchiveCallback } = await import('../dist/src/handlers/onManagement.js');
    await onArchiveCallback(outsider); assert.equal(outsider.session.confirmation, undefined);
    await previewGif(context, 'uxa', 'uxshared');
    const previewId = context.replies.length;
    context.message = { text: '/edit', reply_to_message: { message_id: previewId } };
    assert.equal(await replyScope(context), 'uxa'); verifyRendered(context);
  });

  await parent.test('UX: group saving is deliberate, reply-bound and inline results are ignored', async () => {
    await scopes.createScope('-300', 'UX Group', 'group', [51]);
    const group = make({ chat: { id: -300, type: 'supergroup', title: 'UX Group' }, currentScopeId: '-300', message: { message_id: 91, animation: { file_unique_id: 'uxgroup', file_id: 'group' } } });
    await onAnimation(group); assert.equal(group.session.state, 'IDLE'); assert.equal(group.replies.length, 0);
    group.message = { message_id: 92, text: '/add' }; await onAdd(group);
    assert.equal(group.session.state, 'WAITING_FOR_UPLOAD');
    assert(group.replies.at(-1).options.reply_markup.force_reply);
    assert(group.replies.at(-1).text.includes('tg://user?id=51'));
    const uploadPrompt = group.session.pendingMessageId;
    group.message = { animation: { file_unique_id: 'uxgroup', file_id: 'group' } }; await onAnimation(group);
    assert.equal(group.session.state, 'WAITING_FOR_UPLOAD');
    group.message.reply_to_message = { message_id: uploadPrompt }; await onAnimation(group);
    const tagPrompt = group.session.pendingMessageId;
    group.message = { text: '#group' }; await onText(group); assert.equal(await meili.getGifInScope('uxgroup', '-300'), null);
    group.message.reply_to_message = { message_id: tagPrompt }; await onText(group);
    assert(await meili.getGifInScope('uxgroup', '-300'));
    const inline = make({ message: { via_bot: { id: 123456 }, animation: { file_unique_id: 'uxinline', file_id: 'inline' } } });
    await onAnimation(inline); assert.equal(inline.session.state, 'IDLE'); assert.equal(inline.replies.length, 0);
    await scopes.removeUserFromScope(51, '-300', { protectLastAdmin: false });
  });

  await parent.test('UX: file replacement is explicit and keeps the captured archive and labels', async () => {
    const { onArchiveCallback } = await import('../dist/src/handlers/onManagement.js');
    const context = make(); const handle = await gifHandle(context, 'uxa', 'uxshared');
    callback(context, `archive:file:${handle}`); await onArchiveCallback(context);
    assert.equal(context.session.state, 'WAITING_FOR_REPLACEMENT');
    context.currentScopeId = 'uxb'; context.message = { animation: { file_unique_id: 'uxreplaced', file_id: 'replacement-file' } };
    await onAnimation(context);
    assert.equal(await meili.getGifInScope('uxshared', 'uxa'), null);
    assert.deepEqual((await meili.getGifInScope('uxreplaced', 'uxa')).tags, ['#same']);
    assert(await meili.getGifInScope('uxshared', 'uxb'));
    await meili.replaceGif('uxreplaced', 'uxshared', 'shared-a', 'uxa'); verifyRendered(context);
  });

  await parent.test('UX: expired prompts do not save and stale replied input has a recovery message', async () => {
    const context = make({ message: { animation: { file_unique_id: 'uxexpired', file_id: 'expired-file' } } });
    await onAnimation(context); const prompt = context.session.pendingMessageId;
    context.session.pendingExpiresAt = Date.now() - 1; context.message = { text: '#late' }; await onText(context);
    assert.equal(context.session.state, 'IDLE'); assert.equal(await meili.getGifInScope('uxexpired', 'uxa'), null);
    context.message = { text: '#late', reply_to_message: { message_id: prompt } }; await onText(context);
    assert.equal(context.replies.at(-1).text, t('en', 'pending_expired'));
  });

  await parent.test('UX: group setup acknowledges permissions and personal picker stays private', async () => {
    const group = make({ chat: { id: -300, type: 'supergroup', title: 'UX Group' }, currentScopeId: '-300', myChatMember: { chat: { id: -300, type: 'supergroup', title: 'UX Group' }, old_chat_member: { status: 'left' }, new_chat_member: { status: 'member' } }, getChatAdministrators: async () => [{ user: { id: 51, is_bot: false } }] });
    await onMyChatMember(group); assert(text(group).includes('Setup incomplete'));
    await onScopes(group); assert(group.replies.flatMap(buttons).some(button => button.url?.endsWith('start=communities')));
    assert.equal(await scopes.getActiveScopeId(51), 'uxa');
    await scopes.removeUserFromScope(51, '-300', { protectLastAdmin: false });
  });

  await parent.test('UX: used invites recover and opening community info does not switch destination', async () => {
    const invite = make(); await onInvite(invite); assert(text(invite).includes('works once'));
    const payload = text(invite).match(/start=join_([a-f0-9]+)/)[1];
    const invited = make({ from: { id: 55 }, currentScopeId: undefined, message: { text: `/start join_${payload}` } });
    await onJoinScope(invited); assert(await scopes.isMemberOfScope(55, 'uxa'));
    await onJoinScope(invited); assert(text(invited).includes('already used'));
    const existing = make(); await scopes.setActiveScopeId(51, 'uxb'); await onDirectJoinScope(existing, 'uxa');
    assert.equal(await scopes.getActiveScopeId(51), 'uxb'); await scopes.setActiveScopeId(51, 'uxa');
    verifyRendered(invited);
  });

  await parent.test('UX: guided names parse bot mentions and language override refreshes private menus', async () => {
    const create = make({ message: { text: '/create@testbot New name' } }); await onCreateScope(create);
    const createdId = create.currentScopeId; assert.equal((await scopes.getScope(createdId)).name, 'New name');
    const rename = make({ currentScopeId: createdId, message: { text: '/rename@testbot Newer name' } }); await onRename(rename);
    assert.equal((await scopes.getScope(createdId)).name, 'Newer name');
    const prompted = make({ message: { text: '/create' } }); await onCreateScope(prompted); assert.equal(prompted.session.state, 'WAITING_FOR_NAME'); await onCancel(prompted);
    const menus = [];
    const language = make({ currentScopeId: createdId, api: { setMyCommands: async (list, opts) => { menus.push({ list, opts }); } } });
    callback(language, 'lang:set:uk'); await onLangSetCallback(language);
    assert(menus.length >= 3); assert(menus.every(menu => menu.list.some(command => command.command === 'add')));
    assert(language.replies.some(item => item.options?.reply_markup?.keyboard?.flat().some(button => button.text === t('uk', 'btn_search'))));
    assert(text(language).includes('Ваші гіфки')); assert(!text(language).includes('Ласкаво просимо'));
    verifyRendered(language); await redis.del('user_lang:51'); await scopes.setActiveScopeId(51, 'uxa');
  });

  await parent.test('UX: temporary group verification gives retry without deleting memberships', async () => {
    await scopes.addUserToScope(51, '-300');
    const api = { getChatMember: async () => { throw new Error('rate limited'); } };
    assert.equal(await getScopeAccess(api, 51, await scopes.getScope('-300')), 'unavailable');
    await assert.rejects(getAccessibleScopes(api, 51), ScopeVerificationError);
    assert(await scopes.isMemberOfScope(51, '-300'));
    const answers = []; await onInline(make({ api, inlineQuery: { query: '', offset: '' }, answerInlineQuery: async (results, options) => answers.push({ results, options }) }));
    assert.equal(answers[0].results.length, 0); assert.equal(answers[0].options.button.text, t('en', 'btn_retry'));
    await scopes.removeUserFromScope(51, '-300', { protectLastAdmin: false });
  });

  await parent.test('UX: notifications respect preferences, name their source and retain reply context', async () => {
    const deliveries = [];
    const api = { sendAnimation: async (id, file, opts) => { deliveries.push({ id, file, opts }); return { message_id: 700 }; }, getChatMember: async (_chat, id) => ({ status: 'administrator', user: { id } }) };
    await broadcastNewGif(api, 52, 'shared-a', ['#same'], [], 'uxa', 'uxshared');
    assert.equal(deliveries.length, 1); assert(deliveries[0].opts.caption.includes('Friends'));
    const receiver = make({ message: { text: '/edit', reply_to_message: { message_id: 700 } } }); assert.equal(await replyScope(receiver), 'uxa');
    const setting = make(); callback(setting, 'nav:notify:uxa:off'); await onNavigation(setting);
    await broadcastNewGif(api, 52, 'shared-a', ['#same'], [], 'uxa', 'uxshared'); assert.equal(deliveries.length, 1);
    callback(setting, 'nav:notify:uxa:on'); await onNavigation(setting);
  });

  await parent.test('UX: backup DM recovery and empty usage stats have actionable copy', async () => {
    const backup = make({ api: { sendDocument: async () => { throw new GrammyError('blocked', { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 'sendDocument', {}); } } });
    await onBackup(backup); assert(text(backup).includes('press Start'));
    assert(backup.replies.flatMap(buttons).some(button => button.url?.includes('start=backup_uxa')));
    const stats = make(); await onStats(stats); assert(text(stats).includes('Friends')); assert(text(stats).includes('inline'));
    verifyRendered(stats);
  });

  await parent.test('UX: closure requires sole-admin authority, confirmation and typed name; other archives survive', async () => {
    await scopes.createScope('uxclose', 'Close me', 'manual', [51]); await scopes.addUserToScope(56, 'uxclose');
    await meili.upsertGif('uxshared', 'close-file', ['#close'], [], 'uxclose');
    const invite = await scopes.createInviteToken('uxclose', 51);
    await redis.set('notify_muted:uxclose:51', '1'); await redis.zadd('stats:week:uxclose:2026-W40', 1, 'uxclose_uxshared');
    const context = make(); await askConfirmation(context, { action: 'close', scopeId: 'uxclose' });
    let request = context.session.confirmation;
    callback(context, `confirm:yes:${request.token}`, request.messageId); await onConfirmCallback(context);
    assert(context.session.confirmation.awaitingName);
    context.message = { text: 'Wrong name' }; await onText(context); assert(await scopes.getScope('uxclose'));
    context.message.text = 'Close me'; await onText(context);
    assert.equal(await scopes.getScope('uxclose'), null); assert.equal(await redis.exists(`invite:${invite}`), 0);
    assert.equal(await scopes.isMemberOfScope(56, 'uxclose'), false);
    assert.equal(await redis.exists('notify_muted:uxclose:51'), 0); assert.equal(await redis.exists('stats:week:uxclose:2026-W40'), 0);
    assert.equal(await meili.getGifInScope('uxshared', 'uxclose'), null); assert(await meili.getGifInScope('uxshared', 'uxb'));
    const multi = make(); await askConfirmation(multi, { action: 'close', scopeId: 'uxa' }); assert.equal(multi.session.confirmation, undefined);
    verifyRendered(context);
  });

  await parent.test('UX: actual middleware handles unknown/private media and source-aware edit routing', async () => {
    const bot = createBot(); bot.botInfo = { id: 123456, is_bot: true, first_name: 'Test', username: 'testbot' };
    const sent = [];
    bot.api.config.use(async (_prev, method, payload) => { sent.push({ method, payload }); return { ok: true, result: method === 'getChatMember' ? { status: 'administrator', user: { id: payload.user_id } } : { message_id: 800, chat: { id: payload.chat_id, type: 'private' } } }; });
    const base = { date: 1, chat: { id: 51, type: 'private' }, from: { id: 51, is_bot: false, first_name: 'Admin' } };
    await redis.del('51'); await scopes.setActiveScopeId(51, 'uxb');
    await bot.handleUpdate({ update_id: 900, message: { ...base, message_id: 900, text: '/unknown', entities: [{ type: 'bot_command', offset: 0, length: 8 }] } });
    assert(sent.some(item => item.payload.text === t('en', 'unknown_command')));
    await bot.handleUpdate({ update_id: 901, message: { ...base, message_id: 901, sticker: { file_id: 'sticker', file_unique_id: 'sticker', type: 'regular', width: 10, height: 10, is_animated: false, is_video: false } } });
    assert(sent.some(item => item.payload.text === t('en', 'unsupported_media')));
    await bot.handleUpdate({ update_id: 902, message: { ...base, message_id: 902, text: '/edit #source', entities: [{ type: 'bot_command', offset: 0, length: 5 }], reply_to_message: { message_id: 700, animation: { file_unique_id: 'uxshared', file_id: 'shared-a', width: 10, height: 10, duration: 1 } } } });
    const pending = JSON.parse(await redis.get('51'));
    assert.equal(pending.confirmation.scopeId, 'uxa');
    assert.deepEqual((await meili.getGifInScope('uxshared', 'uxb')).tags, ['#same']);
    await redis.del('51'); await scopes.setActiveScopeId(51, 'uxa');
  });
}
