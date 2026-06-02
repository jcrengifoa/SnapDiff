# Changelog

## 0.2.5
- Fixed swipe direction: handle now stays aligned with the visual divider
  between Original and Modified.

## 0.2.4
- Fixed image order in swipe mode — Original now appears on the left and
  Modified on the right.
- Fixed label dimming: the "Modified" label now fades along with the image
  in Opacity and Onion-skin modes.

## 0.2.3
- Renamed image labels from "HEAD / Working tree" to "Original / Modified" for
  clearer user-facing terminology.

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
