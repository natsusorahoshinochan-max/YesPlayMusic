import md5 from 'crypto-js/md5';

export default function createSession(
  snapshot,
  {
    credentials,
    identityChanged = () => {},
    auth = {},
    navigate = () => {},
    notify = () => {},
    alert = () => {},
    now = () => new Date(),
    time = {
      schedule: (callback, delay) => setTimeout(callback, delay),
      cancel: handle => clearTimeout(handle),
    },
  }
) {
  let qrRun;
  function stopQr() {
    if (!qrRun) return;
    qrRun.stopped = true;
    time.cancel(qrRun.timer);
    qrRun = null;
  }

  async function createQr(context, run) {
    const result = await auth.loginQrCodeKey();
    if (run.stopped || result.code !== 200) return;
    run.key = result.data.unikey;
    context.commit('setQr', {
      url: `https://music.163.com/login?codekey=${run.key}`,
    });
  }

  function scheduleQr(context, run) {
    if (run.stopped || !run.key) return;
    run.timer = time.schedule(async () => {
      try {
        const result = await auth.loginQrCodeCheck(run.key);
        if (run.stopped) return;
        if (result.code === 800) {
          context.commit('setQr', { information: '二维码已失效，请重新扫码' });
          await createQr(context, run);
        } else if (result.code === 803) {
          stopQr();
          context.commit('setQr', { information: '登录成功，请稍等...' });
          try {
            await enterAccount(
              context,
              result.cookie.replaceAll(' HTTPOnly', '')
            );
          } catch {
            notify('登录失败，请重试');
          }
        } else if (result.code === 802) {
          context.commit('setQr', {
            information: '扫描成功，请在手机上确认登录',
          });
        } else if (result.code === 801) {
          context.commit('setQr', { information: '打开网易云音乐APP扫码登录' });
        }
      } catch {
        if (!run.stopped) {
          context.commit('setQr', { information: '二维码连接失败，正在重试' });
        }
      } finally {
        scheduleQr(context, run);
      }
    }, 1000);
  }

  async function clearIdentity({ commit, dispatch }) {
    identityChanged();
    credentials.remove('MUSIC_U');
    credentials.remove('__csrf');
    commit('setIdentity', { loginMode: null, hasCredential: false });
    await dispatch('library/clearIdentity', null, { root: true });
  }

  async function enterAccount({ commit, dispatch }, cookie) {
    identityChanged();
    credentials.set(cookie);
    commit('setIdentity', {
      loginMode: 'account',
      hasCredential: Boolean(credentials.get('MUSIC_U')),
    });
    await dispatch('library/loadApplication', null, { root: true });
    await navigate('account');
  }

  return {
    namespaced: true,
    state: () => ({
      ...snapshot,
      processing: false,
      qr: { url: '', information: '打开网易云音乐APP扫码登录' },
      hasCredential: false,
    }),
    getters: {
      qr: state => state.qr,
      processing: state => state.processing,
      hasAccount: state => state.loginMode === 'account' && state.hasCredential,
      hasLibraryIdentity: (state, getters) =>
        getters.hasAccount || state.loginMode === 'username',
    },
    mutations: {
      setQr(state, value) {
        Object.assign(state.qr, value);
      },
      setProcessing(state, value) {
        state.processing = value;
      },
      setIdentity(state, { loginMode, hasCredential }) {
        state.loginMode = loginMode;
        state.hasCredential = hasCredential;
      },
      setLastRefreshCookieDate(state, value) {
        state.lastRefreshCookieDate = value;
      },
    },
    actions: {
      async startQrLogin(context) {
        stopQr();
        const run = { stopped: false, timer: null, key: '' };
        qrRun = run;
        context.commit('setQr', {
          url: '',
          information: '打开网易云音乐APP扫码登录',
        });
        try {
          await createQr(context, run);
          scheduleQr(context, run);
        } catch {
          if (!run.stopped)
            context.commit('setQr', { information: '二维码加载失败，请重试' });
        }
      },
      stopQrLogin() {
        stopQr();
      },
      restore({ state, commit }) {
        commit('setIdentity', {
          loginMode: state.loginMode,
          hasCredential: Boolean(credentials.get('MUSIC_U')),
        });
      },
      async loginWithPassword(
        context,
        { mode, countryCode, phone, email, password }
      ) {
        context.commit('setProcessing', true);
        try {
          const params = {
            password: 'fakePassword',
            md5_password: md5(password).toString(),
          };
          const result =
            mode === 'phone'
              ? await auth.loginWithPhone({
                  ...params,
                  countrycode: countryCode.replace('+', '').replace(/\s/g, ''),
                  phone: phone.replace(/\s/g, ''),
                })
              : await auth.loginWithEmail({
                  ...params,
                  email: email.replace(/\s/g, ''),
                });
          if (result?.code === 200) {
            await enterAccount(context, result.cookie);
          } else if (result) {
            alert(result.msg ?? result.message ?? '账号或密码错误，请检查');
          }
          return result;
        } catch (error) {
          alert(`发生错误，请检查你的账号密码是否正确\n${error}`);
        } finally {
          context.commit('setProcessing', false);
        }
      },
      async selectPublicIdentity({ commit, dispatch }, user) {
        identityChanged();
        commit('setIdentity', {
          loginMode: 'username',
          hasCredential: Boolean(credentials.get('MUSIC_U')),
        });
        commit('library/setUser', user, { root: true });
        await dispatch('library/loadApplication', null, { root: true });
        return navigate('publicIdentity');
      },
      async refreshDaily({ state, getters, commit }) {
        if (
          !getters.hasAccount ||
          state.lastRefreshCookieDate === now().getDate() ||
          !auth.refreshCookie
        )
          return;
        try {
          await auth.refreshCookie();
          commit('setLastRefreshCookieDate', now().getDate());
        } catch {
          notify('登录状态刷新失败');
        }
      },
      async invalidate(context) {
        await clearIdentity(context);
        notify('登录状态已失效，请重新登录');
        return navigate('invalidated');
      },
      async logout(context) {
        try {
          if (auth.logout) Promise.resolve(auth.logout()).catch(() => {});
        } catch {
          // Local exit remains available when the remote service cannot respond.
        }
        await clearIdentity(context);
        return navigate('logout');
      },
    },
  };
}
