/* global __static */
import path from 'path';
import { nativeImage, Tray, Menu, nativeTheme } from 'electron';
import { isLinux } from '@/utils/platform';

function getTrayIconTheme(store) {
  const trayIconTheme = store.get('settings.trayIconTheme');
  if (trayIconTheme === 'light' || trayIconTheme === 'dark') {
    return trayIconTheme;
  }

  return nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
}

function createMenuIcon(filename, iconTheme) {
  const image = nativeImage.createFromPath(
    path.join(__static, `img/icons/${filename}.png`)
  );

  if (iconTheme === 'dark') return image;

  const bitmap = image.toBitmap();
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    // NativeImage bitmaps use premultiplied alpha, so white RGB values
    // must match the pixel's alpha value to preserve antialiased edges.
    const alpha = bitmap[offset + 3];
    bitmap[offset] = alpha;
    bitmap[offset + 1] = alpha;
    bitmap[offset + 2] = alpha;
  }

  return nativeImage.createFromBitmap(bitmap, image.getSize());
}

function createMenuTemplate(win, store, windowOperations) {
  const iconTheme = getTrayIconTheme(store);

  return [
    {
      label: '播放',
      icon: createMenuIcon('play', iconTheme),
      click: () => {
        win.webContents.send('play');
      },
      id: 'play',
    },
    {
      label: '暂停',
      icon: createMenuIcon('pause', iconTheme),
      click: () => {
        win.webContents.send('pause');
      },
      id: 'pause',
      visible: false,
    },
    {
      label: '上一首',
      icon: createMenuIcon('left', iconTheme),
      accelerator: 'CmdOrCtrl+Left',
      click: () => {
        win.webContents.send('previous');
      },
    },
    {
      label: '下一首',
      icon: createMenuIcon('right', iconTheme),
      accelerator: 'CmdOrCtrl+Right',
      click: () => {
        win.webContents.send('next');
      },
    },
    {
      label: '循环播放',
      icon: createMenuIcon('repeat', iconTheme),
      accelerator: 'Alt+R',
      click: () => {
        win.webContents.send('repeat');
      },
    },
    {
      label: '加入喜欢',
      icon: createMenuIcon('like', iconTheme),
      accelerator: 'CmdOrCtrl+L',
      click: () => {
        win.webContents.send('like');
      },
      id: 'like',
    },
    {
      label: '取消喜欢',
      icon: createMenuIcon('unlike', iconTheme),
      accelerator: 'CmdOrCtrl+L',
      click: () => {
        win.webContents.send('like');
      },
      id: 'unlike',
      visible: false,
    },
    {
      label: '退出',
      icon: createMenuIcon('exit', iconTheme),
      accelerator: 'CmdOrCtrl+W',
      click: () => {
        windowOperations.quit();
      },
    },
  ];
}

function createTrayImage(store) {
  const iconTheme = getTrayIconTheme(store);
  return nativeImage
    .createFromPath(path.join(__static, `img/icons/menu-${iconTheme}@88.png`))
    .resize({ height: 20, width: 20 });
}

export function createTray(win, eventEmitter, store, windowOperations) {
  const tray = new Tray(createTrayImage(store));
  tray.setToolTip('YesPlayMusic');
  const template = createMenuTemplate(win, store, windowOperations);
  if (isLinux) {
    template.unshift(
      { label: '显示主面板', click: () => win.show() },
      { type: 'separator' }
    );
  }
  const contextMenu = Menu.buildFromTemplate(template);
  if (isLinux) tray.setContextMenu(contextMenu);
  else tray.on('right-click', () => tray.popUpContextMenu(contextMenu));
  tray.on('click', () => win.show());

  eventEmitter.on('updateTooltip', title => tray.setToolTip(title));
  eventEmitter.on('updatePlayState', isPlaying => {
    contextMenu.getMenuItemById('play').visible = !isPlaying;
    contextMenu.getMenuItemById('pause').visible = isPlaying;
    if (isLinux) tray.setContextMenu(contextMenu);
  });
  eventEmitter.on('updateLikeState', isLiked => {
    contextMenu.getMenuItemById('like').visible = !isLiked;
    contextMenu.getMenuItemById('unlike').visible = isLiked;
    if (isLinux) tray.setContextMenu(contextMenu);
  });
  eventEmitter.on('updateIcon', () => tray.setImage(createTrayImage(store)));
  return tray;
}
