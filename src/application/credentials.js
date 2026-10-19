import Cookies from 'js-cookie';

export function createCredentials({
  storage = localStorage,
  document: cookieDocument = document,
  cookies = Cookies,
} = {}) {
  return {
    get(key) {
      return cookies.get(key) || storage.getItem(`cookie-${key}`);
    },
    set(string) {
      string
        .split(';;')
        .filter(Boolean)
        .forEach(cookie => {
          cookieDocument.cookie = cookie;
          const pair = cookie.split(';')[0];
          const index = pair.indexOf('=');
          storage.setItem(
            `cookie-${pair.slice(0, index)}`,
            pair.slice(index + 1)
          );
        });
    },
    remove(key) {
      cookies.remove(key);
      storage.removeItem(`cookie-${key}`);
    },
  };
}
