/**
 * Optional ribbon command entry. Office.js requires this file to exist if
 * the manifest declares function commands; we ship an empty handler so the
 * ribbon "Open Glyph" button falls through to the declared task-pane action.
 */

function hasOffice(): boolean {
  return typeof (globalThis as { Office?: unknown }).Office !== 'undefined';
}

if (hasOffice()) {
  void Office.onReady(() => {
    Office.actions.associate('openGlyphTaskpane', (event: Office.AddinCommands.Event) => {
      event.completed();
    });
  });
}
