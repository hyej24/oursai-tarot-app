type SharePayload = {
  title?: string;
  text: string;
  url?: string;
};

type ShareRewardResult = 'rewarded' | 'closed' | 'unsupported' | 'failed';

export async function shareAppMessage({ title, text, url }: SharePayload): Promise<'shared' | 'copied' | 'failed'> {
  const message = [text, url].filter(Boolean).join('\n');

  try {
    const framework = await import('@apps-in-toss/web-framework');
    if (typeof framework.share === 'function') {
      await framework.share({ message });
      return 'shared';
    }
  } catch {
    // 앱인토스 밖의 브라우저 미리보기에서는 네이티브 공유가 지원되지 않을 수 있어요.
  }

  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return 'shared';
    }
  } catch {
    return 'failed';
  }

  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(message);
      return 'copied';
    }
  } catch {
    return 'failed';
  }

  return 'failed';
}

export async function openShareReward(moduleId: string): Promise<ShareRewardResult> {
  try {
    const framework = await import('@apps-in-toss/web-framework');
    const contactsViral = (framework as unknown as {
      contactsViral?: (params: {
        options: { moduleId: string };
        onEvent: (event: { type: string; data?: { rewardAmount?: number; rewardUnit?: string; sentRewardsCount?: number } }) => void;
        onError: (error: unknown) => void;
      }) => (() => void) | undefined;
    }).contactsViral;

    if (typeof contactsViral !== 'function') {
      return 'unsupported';
    }

    return await new Promise<ShareRewardResult>((resolve) => {
      let settled = false;
      let cleanup: (() => void) | undefined;

      const finish = (result: ShareRewardResult) => {
        if (settled) return;
        settled = true;
        try {
          cleanup?.();
        } catch {
          // cleanup 실패는 사용자 플로우를 막지 않아요.
        }
        resolve(result);
      };

      cleanup = contactsViral({
        options: { moduleId: moduleId.trim() },
        onEvent: (event) => {
          if (event.type === 'sendViral') {
            finish('rewarded');
            return;
          }

          if (event.type === 'close') {
            const sentCount = event.data?.sentRewardsCount ?? 0;
            finish(sentCount > 0 ? 'rewarded' : 'closed');
          }
        },
        onError: () => finish('failed')
      });
    });
  } catch {
    return 'failed';
  }
}
