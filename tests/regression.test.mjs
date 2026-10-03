import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { GrammyError } from 'grammy';


import { MeilisearchApiError } from 'meilisearch';

// Never allow test imports to load a real Telegram token from .env.
process.env.BOT_TOKEN = '123456:regression-only';
process.env.SUPER_ADMIN_ID = '999';
process.env.REDIS_HOST ??= 'gifory-test-redis';
process.env.MEILI_HOST ??= 'http://gifory-test-meili:7700';
process.env.MEILI_MASTER_KEY = '';
const { runUxChecks } = await import('./ux-cases.mjs');
const { extractTags, hasInvalidTags, labelsWithinLimit } = await import('../dist/src/utils/tags.js');
const session = await import('../dist/src/session.js');
const scopes = await import('../dist/src/scopes.js');
const meili = await import('../dist/src/meili.js');
const { redis } = await import('../dist/src/redis.js');
const access = await import('../dist/src/access.js');
const { onText } = await import('../dist/src/handlers/onText.js');
const { onGifCallback } = await import('../dist/src/handlers/onCallback.js');
const { onAnimation } = await import('../dist/src/handlers/onAnimation.js');
const { onInline, findValidGifs } = await import('../dist/src/handlers/onInline.js');
const { onDirectJoinScope } = await import('../dist/src/handlers/onJoinScope.js');
const { onLeaveCallback } = await import('../dist/src/handlers/onLeave.js');
const { onChatMember } = await import('../dist/src/handlers/onChatMember.js');
const { onMembers } = await import('../dist/src/handlers/onMembers.js');
const { formatUserLink, saveUserProfile } = await import('../dist/src/users.js');
const { t, setUserLang } = await import('../dist/src/i18n/index.js');
const { en } = await import('../dist/src/i18n/en.js');
const { uk } = await import('../dist/src/i18n/uk.js');
const { captureFullBackup, scopeBackup } = await import('../dist/src/backupData.js');
const { deliverWeeklyBackup, sendBackup } = await import('../dist/src/backup.js');
const { readFullBackup, restoreFullBackup } = await import('../dist/src/recovery.js');
const { trackUsage, getAnalytics, trimUsage } = await import('../dist/src/analytics.js');
const { withStateLock } = await import('../dist/src/state.js');
const { runBot } = await import('../dist/src/lifecycle.js');
const { createBot } = await import('../dist/src/bot.js');

function ctx(overrides = {}) {
  const replies = [];
  return {
    from: { id: 1 }, chat: { id: 1, type: 'private' }, currentScopeId: 'a',
    session: session.initialSessionData(), message: { text: '#updated' }, me: { username: 'testbot' },
    t: (key, params) => t('en', key, params), replies,
    reply: async (text, options) => { replies.push({ text, options }); return { message_id: replies.length }; },
    editMessageText: async (text, options) => { replies.push({ text, options }); },
    answerCallbackQuery: async options => { replies.push({ callback: options }); },
    editMessageReplyMarkup: async () => {},
    replyWithAnimation: async (fileId, options) => { replies.push({ animation: fileId, options }); return { message_id: replies.length }; },
    react: async () => {}, ...overrides,
    api: { getChatMember: async (_chat, id) => ({ status: "administrator", user: { id } }), setMyCommands: async () => true, ...overrides.api },
  };
}
function telegramError(code, description) {
  return new GrammyError(description, { ok: false, error_code: code, description }, 'getFile', {});
}

test('locales, escaped member links, and session isolation', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(uk).sort());
  for (const key of Object.keys(en)) {
    assert.deepEqual([...en[key].matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), [...uk[key].matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), key);
  }
  assert.equal(t('en', 'scope_set_active', { name: '{name}' }), en.scope_set_active);
  const link = formatUserLink(1, { first_name: '<a>&user', id: 1 });
  assert(link.includes('&lt;a&gt;&amp;user'));
  assert.equal(session.getSessionKey(ctx()), '1');
  assert.notEqual(session.getSessionKey(ctx({ chat: { id: -100, type: 'group' } })), session.getSessionKey(ctx({ from: { id: 2 }, chat: { id: -100, type: 'group' } })));
});

test('file probes preserve transient failures and accept any successful getFile path', async () => {
  const docs = [1, 2, 3].map(i => ({ id: `a_${i}`, file_id: String(i) }));
  const result = await findValidGifs({ getFile: async id => {
    if (id === '1') return { file_path: 'documents/gif.mp4' };
    throw telegramError(id === '2' ? 400 : 429, id === '2' ? 'Bad Request: wrong file identifier/HTTP URL specified' : 'Too Many Requests');
  } }, docs);
  assert.deepEqual(result.valid.map(g => g.file_id), ['1']);
  assert.deepEqual(result.invalid.map(g => g.file_id), ['2']);
});

test('Unicode tags preserve complete labels and reject punctuation truncation', () => {
  assert.deepEqual(extractTags('#Радість #радість #café #日本語'), ['#радість', '#café', '#日本語']);
  assert.equal(hasInvalidTags('#добрий-день'), true);
  assert.equal(hasInvalidTags('#радість 😂'), false);
  assert.equal(hasInvalidTags('#️⃣'), false);
  assert.equal(labelsWithinLimit(['#' + 'a'.repeat(64)], []), false);
  assert.equal(labelsWithinLimit(Array.from({ length: 33 }, (_, i) => `#tag${i}`), []), false);
});

test('shared state lock lets backup capture finish before subsequent writes', async () => {
  const events = [];
  await Promise.all([withStateLock(async () => { events.push('snapshot-start'); await new Promise(r => setTimeout(r, 10)); events.push('snapshot-end'); }), withStateLock(async () => { events.push('write'); })]);
  assert.deepEqual(events, ['snapshot-start', 'snapshot-end', 'write']);
});

const integration = process.env.GIFORY_INTEGRATION === '1';
test('isolated Redis/Meilisearch regression and full recovery', { skip: !integration }, async parent => {
  // Destructive recovery checks are allowed only against explicitly named disposable services.
  assert.equal(process.env.REDIS_HOST, 'gifory-test-redis');
  assert.equal(process.env.MEILI_HOST, 'http://gifory-test-meili:7700');
  assert.equal(await redis.dbsize(), 0, 'test Redis must start empty');
  try {
    await meili.setupMeilisearch();
    await scopes.createScope('a', '<Archive & A>', 'manual', [1, 2]);
    await scopes.createScope('b', 'B', 'manual', [1]);
    await scopes.createScope('-100', 'Group', 'group', [1]);
    await scopes.setActiveScopeId(1, 'a');

    await parent.test('missing expiry, legacy documents, successful writes, and scope filters', async () => {
      await meili.upsertGif('one', 'file-one', ['#original'], [], 'a');
      await meili.upsertGif('one', 'file-b', ['#private'], [], 'b');
      await meili.waitForWrite(await meili.gifIndex.addDocuments([{ id: 'a_legacy', file_unique_id: 'legacy', file_id: 'legacy-file', scope_id: 'a', tags: ['#legacy'], emojis: [], created_at: 1 }]));
      assert.equal((await meili.searchGifs('', ['a'])).length, 2);
      assert.equal((await meili.getTagFacets('a'))['#legacy'], 1);
      assert((await meili.searchGifs('', ['a'])).every(doc => doc.scope_id === 'a'));
      const one = await meili.getGifInScope('one', 'a');
      await meili.markGifExpired(one);
      assert(!(await meili.searchGifs('', ['a'])).some(doc => doc.id === 'a_one'));
      await onAnimation(ctx({ message: { animation: { file_unique_id: 'one', file_id: 'file-one' } } }));
      assert.equal((await meili.getGifInScope('one', 'a')).expired, false);
    });

    await parent.test('self replacement preserves source; existing destination tags merge', async () => {
      assert.equal(await meili.replaceGif('one', 'one', 'fresh-one', 'a'), true);
      assert.equal((await meili.getGifInScope('one', 'a')).file_id, 'fresh-one');
      await meili.upsertGif('dest', 'dest-file', ['#destination'], ['🎉'], 'a');
      assert.equal(await meili.replaceGif('one', 'dest', 'fresh-dest', 'a'), true);
      assert.deepEqual(new Set((await meili.getGifInScope('dest', 'a')).tags), new Set(['#original', '#destination']));
      assert.equal(await meili.getGifInScope('one', 'a'), null);
      assert.equal((await meili.getGifInScope('one', 'b')).file_id, 'file-b');
    });

    await parent.test('failed indexing never deletes source; auth outages never become not-found', async () => {
      const originalAdd = meili.gifIndex.addDocuments;
      const originalGet = meili.gifIndex.getDocument;
      try {
        meili.gifIndex.addDocuments = function () { return originalAdd.call(this, [{ id: '!invalid-id' }]); };
        await assert.rejects(meili.replaceGif('legacy', 'broken', 'file-broken', 'a'), /Meilisearch task/);
        assert(await meili.getGifInScope('legacy', 'a'));
        meili.gifIndex.getDocument = async () => { throw new MeilisearchApiError(new Response('', { status: 401 }), { code: 'invalid_api_key', message: 'unauthorized', type: 'auth', link: '' }); };
        await assert.rejects(meili.upsertGif('legacy', 'bad', ['#lost'], [], 'a'));
      } finally { meili.gifIndex.addDocuments = originalAdd; meili.gifIndex.getDocument = originalGet; }
    });

    await parent.test('pending scope is checked independently; expired/deleted flows do not claim success', async () => {
      await scopes.removeUserFromScope(1, 'a'); // Admin 2 still owns A; user 1 still owns B.
      const pending = ctx({ currentScopeId: 'b', session: { state: 'WAITING_TO_REPLACE_TAGS', pendingScopeId: 'a', pendingGifUniqueId: 'legacy' } });
      await onText(pending);
      assert.equal(pending.session.state, 'IDLE');
      assert.equal(pending.replies[0].text, t("en", "scope_gone"));
      assert.deepEqual((await meili.getGifInScope('legacy', 'a')).tags, ['#legacy']);
      const deleted = ctx({ from: { id: 2 }, session: { state: 'WAITING_TO_APPEND_TAGS', pendingScopeId: 'a', pendingGifUniqueId: 'missing' } });
      await onText(deleted);
      assert(deleted.replies[0].text.includes('not found'));
      await scopes.addUserToScope(1, 'a'); await scopes.promoteToAdmin(1, 'a', 2);
      const allowed = ctx({ currentScopeId: undefined, session: { state: 'WAITING_TO_REPLACE_TAGS', pendingScopeId: 'a', pendingGifUniqueId: 'legacy' } });
      await onText(allowed); assert.deepEqual((await meili.getGifInScope('legacy', 'a')).tags, ['#updated']);
    });

    await parent.test('callbacks bind to their operation, message, and user session', async () => {
      const pending = { state: 'WAITING_FOR_GIF_ACTION', pendingScopeId: 'a', pendingGifUniqueId: 'legacy', pendingOperationId: '123456abcdef', pendingMessageId: 5 };
      const stale = ctx({ session: { ...pending }, callbackQuery: { data: 'gif:replace_tags:aaaaaaaaaaaa', message: { message_id: 5 } } });
      await onGifCallback(stale); assert.equal(stale.session.state, 'WAITING_FOR_GIF_ACTION');
      const wrongMessage = ctx({ session: { ...pending }, callbackQuery: { data: 'gif:replace_tags:123456abcdef', message: { message_id: 6 } } });
      await onGifCallback(wrongMessage); assert.equal(wrongMessage.session.state, 'WAITING_FOR_GIF_ACTION');
      const current = ctx({ session: { ...pending }, callbackQuery: { data: 'gif:replace_tags:123456abcdef', message: { message_id: 5 } } });
      await onGifCallback(current); assert.equal(current.session.state, 'WAITING_TO_REPLACE_TAGS');
      const duplicate = ctx({ session: { state: 'WAITING_FOR_NEW_TAGS', pendingScopeId: 'a', pendingGifUniqueId: 'wrong', pendingFileId: 'wrong-file' }, message: { animation: { file_unique_id: 'legacy', file_id: 'legacy-file' } } });
      await onAnimation(duplicate); assert.equal(duplicate.session.state, 'WAITING_FOR_NEW_TAGS'); assert.equal(duplicate.session.pendingFileId, 'wrong-file'); assert.equal(duplicate.session.paused, true);
    });

    await parent.test('single-use invites, last-admin concurrent leaves, and no lost admin updates', async () => {
      const token = await scopes.createInviteToken('a', 1);
      const joined = await Promise.all([scopes.consumeInviteToken(token, 3), scopes.consumeInviteToken(token, 4)]);
      assert.equal(joined.filter(Boolean).length, 1);
      await scopes.createScope('leave', 'Leave', 'manual', [10, 11]);
      const result = await Promise.all([scopes.removeUserFromScope(10, 'leave'), scopes.removeUserFromScope(11, 'leave')]);
      assert.deepEqual(new Set(result), new Set(['removed', 'last_admin']));
      const sole = (await scopes.getScope('leave')).admin_ids[0];
      const confirmation = ctx({ from: { id: sole }, callbackQuery: { data: 'leave:confirm:leave' } });
      await onLeaveCallback(confirmation); assert.equal((await scopes.getScope('leave')).admin_ids.length, 1);
      await scopes.addUserToScope(7, 'a'); await scopes.addUserToScope(8, 'a');
      await Promise.all([scopes.promoteToAdmin(7, 'a', 1), scopes.promoteToAdmin(8, 'a', 1), scopes.renameScope('a', 'Renamed', 1)]);
      assert((await scopes.getScope('a')).admin_ids.includes(7)); assert((await scopes.getScope('a')).admin_ids.includes(8)); assert.equal((await scopes.getScope('a')).name, 'Renamed');
      await scopes.syncGroupAdmins('-100', []); assert.deepEqual((await scopes.getScope('-100')).admin_ids, []);
    });

    await parent.test('join links do not grant access; group departure and verification revoke it', async () => {
      const stranger = ctx({ from: { id: 20 } }); await onDirectJoinScope(stranger, 'a'); assert.equal(await scopes.isMemberOfScope(20, 'a'), false);
      await scopes.addUserToScope(20, '-100'); await scopes.setActiveScopeId(20, '-100');
      const groupApi = { getChatMember: async () => ({ status: 'left', user: { id: 20 } }) };
      assert.equal(await access.canAccessScope(groupApi, 20, '-100'), false);
      assert.equal(await scopes.getActiveScopeId(20), undefined); assert(!(await scopes.getUserScopes(20)).length);
      await scopes.addUserToScope(21, '-100');
      await onChatMember(ctx({ chatMember: { chat: { id: -100 }, old_chat_member: { status: 'member' }, new_chat_member: { status: 'kicked', user: { id: 21 } } } }));
      assert.equal(await scopes.isMemberOfScope(21, '-100'), false);
      await scopes.addUserToScope(22, '-100');
      assert.equal(await access.canAccessScope({ getChatMember: async () => { throw telegramError(429, 'rate limited'); } }, 22, '-100'), false);
      assert.equal(await scopes.isMemberOfScope(22, '-100'), true, 'uncertain access failures do not erase memberships');
    });

    await parent.test('pagination continues after filtering and transient probes never expire storage', async () => {
      for (let i = 0; i < 50; i++) await meili.upsertGif(`page${i}`, `page-file${i}`, ['#page'], [], 'b');
      let answers = 0; let finalOptions;
      const inline = ctx({ inlineQuery: { query: '#page', offset: '' }, api: { getFile: async id => { if (id === 'page-file0') throw telegramError(429, 'Too Many Requests'); return {}; } }, answerInlineQuery: async (_results, options) => { finalOptions = options; if (++answers === 1) throw telegramError(400, 'Bad Request: DOCUMENT_INVALID'); } });
      await onInline(inline); assert.equal(finalOptions.next_offset, '50'); assert.equal(finalOptions.cache_time, 0);
      assert.equal((await meili.getGifInScope('page0', 'b')).expired, false);
      const old = await meili.getGifInScope('page1', 'b'); await meili.refreshGifFileId('page1', 'newer-file', 'b'); await meili.markGifExpired(old);
      assert.equal((await meili.getGifInScope('page1', 'b')).expired, false);
      await meili.upsertGif('pageExtra', 'page-extra', ['#page'], [], 'b');
      let retries = 0; let corrected;
      await onInline(ctx({ inlineQuery: { query: '#page', offset: '' }, api: { getFile: async id => {
        if (id === 'page-file2') throw telegramError(400, 'Bad Request: wrong file identifier'); return {};
      } }, answerInlineQuery: async (_results, options) => { corrected = options; if (++retries === 1) throw telegramError(400, 'DOCUMENT_INVALID'); } }));
      assert.equal(corrected.next_offset, '49', 'expiry shrinks the result set, so the cursor must not skip a live GIF');
      assert.equal((await meili.searchGifs('#page', ['b'], 50, 49)).length, 1);
    });

    await parent.test('member lists are escaped and paginated; Telegram profile fetch concurrency is bounded', async () => {
      for (let id = 30; id < 55; id++) { await scopes.addUserToScope(id, 'a'); await saveUserProfile({ id, first_name: '<bad & name>'.repeat(10) }); }
      await scopes.renameScope('a', '<bad & scope>', 1);
      const members = ctx({ api: { getChat: async id => ({ id, first_name: 'Test' }) } }); await onMembers(members);
      assert(members.replies[0].text.includes('&lt;bad &amp; scope&gt;'));
      assert(members.replies[0].options.reply_markup.inline_keyboard.flat().some(button => button.callback_data?.includes('members:page:')));
      assert(members.replies[0].text.length < 4096);
    });

    await parent.test('analytics retention preserves legacy all-time counts', async () => {
      await redis.zadd('analytics:usage', Date.now() - 100 * 86400000, 'old'); await trackUsage(1); await trimUsage();
      const stats = await getAnalytics(); assert.equal(stats.usage.allTime, 2); assert.equal(await redis.zcard('analytics:usage'), 1);
    });

    await parent.test('bot middleware stores group senders in separate sessions without Telegram calls', async () => {
      const bot = createBot();
      bot.botInfo = { id: 123456, is_bot: true, first_name: 'Test', username: 'testbot' };
      bot.api.config.use(async (_previous, method, payload) => ({ ok: true, result: method === 'getChatMember' ? { status: 'administrator', user: { id: payload.user_id } } : { message_id: 5, chat: { id: payload.chat_id, type: 'supergroup' } } }));
      await scopes.syncGroupAdmins('-100', [1, 2]);
      for (const id of [1, 2]) {
        const base = { date: 1, chat: { id: -100, type: 'supergroup', title: 'Group' }, from: { id, is_bot: false, first_name: 'User' } };
        await bot.handleUpdate({ update_id: id * 10, message: { ...base, message_id: id * 10, text: '/add', entities: [{ type: 'bot_command', offset: 0, length: 4 }] } });
        await bot.handleUpdate({ update_id: id * 10 + 1, message: { ...base, message_id: id * 10 + 1, reply_to_message: { message_id: 5 }, animation: { file_id: `gif${id}`, file_unique_id: `unique${id}`, width: 10, height: 10, duration: 1 } } });
      }
      const first = JSON.parse(await redis.get('-100:1')); const second = JSON.parse(await redis.get('-100:2'));
      assert.equal(first.pendingGifUniqueId, 'unique1'); assert.equal(second.pendingGifUniqueId, 'unique2');
    });

    await runUxChecks(parent, { ctx, scopes, meili, redis, createBot });

    await parent.test('full backup delivery, recipient isolation, gzip reading, and restore round trip', async () => {
      await setUserLang(999, 'uk');
      await redis.set('user_lang:1', 'uk');
      await redis.set('expire-before-restore', 'gone', 'PX', 1500);
      await redis.set('persistent-recovery', 'present');
      const snapshot = await captureFullBackup();
      assert(snapshot.redis.some(entry => entry.key === 'persistent-recovery'));
      const isolated = scopeBackup(snapshot, await scopes.getScope('a'));
      assert(isolated.meilisearch.documents.every(doc => doc.scope_id === 'a'));
      assert(!isolated.redis.some(entry => entry.key === 'user_lang:1'));
      const sent = [];
      const fakeBot = { api: { sendDocument: async (id, file, options) => { sent.push({ id, payload: JSON.parse(file.fileData.toString('utf8')), options }); }, getChatMember: async (_chat, id) => ({ status: 'administrator', user: { id } }) } };
      await deliverWeeklyBackup(fakeBot, snapshot);
      assert.equal(sent[0].id, 999); assert.equal(sent[0].payload.format, 'gifory-full-backup'); assert(sent[0].options.caption.includes('Повний'));
      assert(sent.slice(1).every(item => item.payload.format === 'gifory-scope-backup'));
      await deliverWeeklyBackup(fakeBot, snapshot); assert.equal(sent.filter(item => item.payload.format === 'gifory-full-backup').length, 2, 'every weekend delivers unchanged archives too');
      await assert.rejects(sendBackup({ api: { sendDocument: async () => { throw Error('blocked'); } } }, 999, snapshot, 'failed', ''), /blocked/);
      const dir = await mkdtemp(join(tmpdir(), 'gifory-recovery-'));
      try {
        await writeFile(join(dir, 'full.json.gz'), gzipSync(JSON.stringify(snapshot)));
        const loaded = await readFullBackup(join(dir, 'full.json.gz')); assert.equal(loaded.scopes.length, snapshot.scopes.length);
        await sendBackup({ api: { sendDocument: async (_id, file) => {
          await writeFile(join(dir, file.filename), file.fileData);
        } } }, 999, snapshot, 'multipart', '', 512);
        const multipart = await readFullBackup(join(dir, 'multipart.manifest.json'));
        assert.equal(multipart.meilisearch.documents.length, snapshot.meilisearch.documents.length);
        const manifest = JSON.parse(await readFile(join(dir, 'multipart.manifest.json'), 'utf8'));
        await writeFile(join(dir, manifest.parts[0].name), 'corrupted');
        await assert.rejects(readFullBackup(join(dir, 'multipart.manifest.json')), /checksum/);
        await restoreFullBackup(loaded, false);
        await assert.rejects(restoreFullBackup(loaded, true), /Redis target is not empty/);
        // These are the disposable containers asserted above, never production.
        await redis.flushdb(); await meili.waitForWrite(await meili.gifIndex.deleteAllDocuments());
        await new Promise(r => setTimeout(r, 1600));
        await restoreFullBackup(loaded, true);
        assert.equal(await redis.get('persistent-recovery'), 'present'); assert.equal(await redis.get('expire-before-restore'), null);
        assert.equal(await redis.get('user_lang:1'), 'uk'); assert.equal((await scopes.getScope('a')).name, '<bad & scope>');
        assert.equal((await meili.getAllGifs('b')).length, loaded.meilisearch.documents.filter(doc => doc.scope_id === 'b').length);
        assert((await meili.searchGifs('#page', ['b'])).length > 0);
      } finally { await rm(dir, { recursive: true, force: true }); }
    });
    await parent.test('shutdown waits for the in-flight middleware and closes cron/Redis', async () => {
      const bot = createBot();
      const errors = [];
      bot.catch(error => { errors.push(error); });
      bot.botInfo = { id: 123456, is_bot: true, first_name: 'Test', username: 'testbot' };
      let offered = false; let replied = false;
      bot.api.config.use(async (_previous, method, payload) => {
        if (method === 'getUpdates') {
          if (payload.limit === 1) return { ok: true, result: [] };
          await new Promise(resolve => setTimeout(resolve, 10));
          if (offered) return { ok: true, result: [] };
          offered = true;
          return { ok: true, result: [{ update_id: 1234, message: { message_id: 1, date: 1,
            chat: { id: 77, type: 'private' }, from: { id: 77, is_bot: false, first_name: 'User' },
            text: '/create Shutdown check', entities: [{ type: 'bot_command', offset: 0, length: 7 }] } }] };
        }
        if (method === 'sendMessage') {
          setTimeout(() => process.emit('SIGTERM'), 5);
          await new Promise(resolve => setTimeout(resolve, 80));
          assert.notEqual(redis.status, 'end', 'Redis must remain open until handler and session write complete');
          replied = true;
          return { ok: true, result: { message_id: 2, chat: { id: 77, type: 'private' } } };
        }
        return { ok: true, result: true };
      });
      await runBot(bot);
      assert(replied); assert.equal(errors.length, 0); assert.equal(redis.status, 'end');
    });
  } finally { if (redis.status !== 'end') await redis.quit(); }
});

test.after(() => { redis.disconnect(); });

test('backup upload retries transient failures and rejects unsafe part sizes', async () => {
  let attempts = 0;
  await sendBackup({ api: { sendDocument: async () => {
    if (++attempts === 1) throw telegramError(500, 'Temporary failure');
  } } }, 999, { safe: true }, 'retry', '');
  assert.equal(attempts, 2);
  await assert.rejects(sendBackup({ api: {} }, 999, {}, 'bad', '', 0), /part size/);
});
