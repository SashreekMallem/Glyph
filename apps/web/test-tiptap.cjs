const { Editor } = require('@tiptap/core');
const Document = require('@tiptap/extension-document');
const Paragraph = require('@tiptap/extension-paragraph');
const Text = require('@tiptap/extension-text');

const editor = new Editor({
  extensions: [Document, Paragraph, Text],
  content: '<p>Im a product</p><p>manager at</p><p>Google</p>'
});
console.log(JSON.stringify(editor.getText()));
