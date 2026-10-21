export function createAudioAdapter({
  Howl,
  URL = window.URL,
  Blob = window.Blob,
  outputDevice = () => 'default',
}) {
  return {
    async prepare(descriptor, options = {}) {
      const ownedURL =
        descriptor.kind === 'bytes'
          ? URL.createObjectURL(new Blob([descriptor.bytes]))
          : null;
      let howl;
      let disposed = false;
      let ready = false;
      let rejectPreparation;
      let abortListener;
      const abortError = () =>
        Object.assign(new Error('Audio preparation aborted'), {
          name: 'AbortError',
        });
      const listeners = [];
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (howl) {
          for (const [name, listener] of listeners) howl.off(name, listener);
          howl.unload();
        }
        if (ownedURL) URL.revokeObjectURL(ownedURL);
      };
      const listen = (name, callback) => {
        const listener = (...args) => {
          if (!disposed) callback(...args);
        };
        listeners.push([name, listener]);
        howl.on(name, listener);
      };
      const handle = {
        play() {
          if (!disposed) howl.play();
        },
        pause() {
          if (!disposed) howl.pause();
        },
        seek(seconds) {
          if (!disposed) howl.seek(seconds);
        },
        position() {
          return disposed ? 0 : Number(howl.seek()) || 0;
        },
        setVolume(value) {
          if (!disposed) howl.volume(value);
        },
        async applyOutputDevice(device = outputDevice()) {
          if (disposed) return;
          const nodes = (howl._sounds || []).map(sound => sound._node);
          await Promise.all(nodes.map(node => node?.setSinkId?.(device)));
        },
        dispose,
      };
      try {
        if (options.signal?.aborted) throw abortError();
        const preparationFailure = new Promise((_, reject) => {
          rejectPreparation = reject;
          abortListener = () => {
            dispose();
            reject(abortError());
          };
          options.signal?.addEventListener('abort', abortListener, {
            once: true,
          });
        });
        const prepare = async () => {
          howl = new Howl({
            src: [ownedURL || descriptor.url],
            html5: true,
            preload: false,
            format: ['mp3', 'flac'],
          });
          await new Promise(resolve => {
            listen('play', () => options.onPlay?.());
            listen('pause', () => options.onPause?.());
            listen('end', () => options.onEnd?.());
            const error = (_, detail) => {
              const failure = Object.assign(
                new Error(`Audio failed: ${detail}`),
                {
                  name: 'AudioMediaError',
                  code: typeof detail === 'number' ? detail : undefined,
                }
              );
              if (ready) options.onError?.(failure);
              else rejectPreparation(failure);
            };
            listen('loaderror', error);
            listen('playerror', error);
            listen('load', resolve);
            howl.load();
          });
          handle.setVolume(options.volume ?? 1);
          handle.seek(options.position ?? 0);
          await handle.applyOutputDevice();
          if (disposed) throw abortError();
          ready = true;
          if (options.autoplay) handle.play();
          return handle;
        };
        return await Promise.race([prepare(), preparationFailure]);
      } catch (error) {
        dispose();
        throw error;
      } finally {
        if (abortListener)
          options.signal?.removeEventListener('abort', abortListener);
      }
    },
  };
}
