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

  function failQr(context, run) {
    if (run.stopped) return false;
    stopQr();
    context.commit('setQr', {
      url: '',
      information: '二维码登录失败，请重试',
    });
    return false;
  }

  async function createQr(context, run) {
    try {
      const result = await auth.loginQrCodeKey();
      if (run.stopped) return;
      if (result?.code !== 200 || !result.data?.unikey)
        return failQr(context, run);
      run.key = result.data.unikey;
      context.commit('setQr', {
        url: `https://music.163.com/login?codekey=${run.key}`,
      });
      scheduleQr(context, run);
    } catch (error) {
      return failQr(context, run);
    }
  }

  function scheduleQr(context, run) {
    if (run.stopped) return;
    run.timer = time.schedule(async () => {
      try {
        const result = await auth.loginQrCodeCheck(run.key);
        if (run.stopped) return;
        if (result?.code === 800) {
          context.commit('setQr', { information: '二维码已失效，请重新扫码' });
          await createQr(context, run);
          return;
        }
        if (result?.code === 803) {
          if (typeof result.cookie !== 'string') return failQr(context, run);
          stopQr();
          context.commit('setQr', { information: '登录成功，请稍等...' });
          try {
            await enterAccount(
              context,
              result.cookie.replaceAll(' HTTPOnly', '')
            );
          } catch (error) {
            context.commit('setQr', {
              information: '音乐库加载失败，请重试',
            });
          }
          return;
        }
        if (result?.code === 802) {
          context.commit('setQr', {
            information: '扫描成功，请在手机上确认登录',
          });
        } else if (result?.code === 801) {
          context.commit('setQr', { information: '打开网易云音乐APP扫码登录' });
        } else {
          return failQr(context, run);
        }
        scheduleQr(context, run);
      } catch (error) {
        return failQr(context, run);
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
      hasCredential: Boolean(credentials.get('MUSIC_U')),
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
      startQrLogin(context) {
        stopQr();
        const run = { stopped: false, timer: null, key: '' };
        qrRun = run;
        context.commit('setQr', {
          url: '',
          information: '打开网易云音乐APP扫码登录',
        });
        return createQr(context, run);
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
          } else {
            alert(result?.msg ?? result?.message ?? '登录失败，请稍后重试');
          }
          return result;
        } catch (error) {
          alert('登录或音乐库加载失败，请稍后重试');
        } finally {
          context.commit('setProcessing', false);
        }
      },
      async selectPublicIdentity({ commit, dispatch }, user) {
        commit('setProcessing', true);
        try {
          identityChanged();
          commit('setIdentity', {
            loginMode: 'username',
            hasCredential: Boolean(credentials.get('MUSIC_U')),
          });
          commit('library/setUser', user, { root: true });
          await dispatch('library/loadApplication', null, { root: true });
          await navigate('publicIdentity');
          return true;
        } catch (error) {
          notify('音乐库加载失败，请重试');
          return false;
        } finally {
          commit('setProcessing', false);
        }
      },
      async refreshDaily({ state, getters, commit }) {
        if (
          !getters.hasAccount ||
          state.lastRefreshCookieDate === now().getDate() ||
          !auth.refreshCookie
        )
          return;
        try {
          const result = await auth.refreshCookie();
          if (result?.code !== 200) throw new Error('Refresh unavailable');
          commit('setLastRefreshCookieDate', now().getDate());
          return true;
        } catch (error) {
          notify('登录状态刷新失败，请稍后重试');
          return false;
        }
      },
      async invalidate(context) {
        await clearIdentity(context);
        notify('登录状态已失效，请重新登录');
        return navigate('invalidated');
      },
      async logout(context) {
        try {
          if (auth.logout)
            Promise.resolve(auth.logout()).catch(error => {
              console.debug('[session] remote logout failed', error);
            });
        } catch (error) {
          console.debug('[session] remote logout failed', error);
        }
        await clearIdentity(context);
        try {
          return await navigate('logout');
        } catch (error) {
          notify('已退出登录，页面跳转失败');
          return false;
        }
      },
    },
  };
}
