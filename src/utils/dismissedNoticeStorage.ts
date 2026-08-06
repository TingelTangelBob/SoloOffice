export type NoticeStorageScope =
  | { kind: 'session' }
  | { kind: 'profile'; id: string };

const defaultScope: NoticeStorageScope = { kind: 'session' };

function getStorage(scope: NoticeStorageScope): Storage | null {
  if (typeof window === 'undefined') return null;

  return scope.kind === 'profile' ? window.localStorage : window.sessionStorage;
}

function getStorageKey(noticeId: string, scope: NoticeStorageScope): string {
  const scopeKey = scope.kind === 'profile' ? `profile:${scope.id}` : 'session';
  return `solooffice:dismissed-notice:${scopeKey}:${noticeId}`;
}

function getLegacyStorageKey(noticeId: string, scope: NoticeStorageScope): string {
  const scopeKey = scope.kind === 'profile' ? `profile:${scope.id}` : 'session';
  return `belego:dismissed-notice:${scopeKey}:${noticeId}`;
}

export function isNoticeDismissed(
  noticeId: string,
  scope: NoticeStorageScope = defaultScope,
): boolean {
  try {
    const storage = getStorage(scope);
    if (!storage) return false;
    if (storage.getItem(getStorageKey(noticeId, scope)) === 'true') return true;
    if (storage.getItem(getLegacyStorageKey(noticeId, scope)) === 'true') {
      storage.setItem(getStorageKey(noticeId, scope), 'true');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function dismissNotice(
  noticeId: string,
  scope: NoticeStorageScope = defaultScope,
): void {
  try {
    getStorage(scope)?.setItem(getStorageKey(noticeId, scope), 'true');
  } catch {
    // Storage can be disabled by the browser; closing still works in memory.
  }
}
