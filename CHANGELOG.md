# Changelog

## 0.2.2
- The comparison editor is now **opt-in** (`priority: "option"`): VS Code keeps its
  normal image preview/diff, and SnapDiff opens via the title-bar button or the
  Explorer / Source Control context menus. Use "Reopen Editor With… → SnapDiff" or
  the lens button.
- Added MIT license, keywords, and this changelog.

## 0.2.1
- Added the extension gallery icon.

## 0.2.0
- Renamed to **SnapDiff** with a custom aperture-split toolbar icon.

## 0.1.x
- Initial release: swipe, opacity, onion-skin, and redline (pixel-diff) comparison of
  an image's working-tree version against `HEAD`.
- Cursor-anchored zoom (buttons + Ctrl/Cmd-scroll) and a working "Fit".
- Launch from the editor title bar, the Explorer, the Source Control view, or the
  command palette; resolves the image from built-in diff editors and SCM resources.
