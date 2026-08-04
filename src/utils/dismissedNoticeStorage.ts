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
  return `belego:dismissed-notice:${scopeKey}:${noticeId}`;
}

export function isNoticeDismissed(
  noticeId: string,
  scope: NoticeStorageScope = defaultScope,
): boolean {
  try {
    return getStorage(scope)?.getItem(getStorageKey(noticeId, scope)) === 'true';
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
