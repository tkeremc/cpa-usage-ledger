from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from cpa_usage_ledger.panel_patch import patch_panel, name_helpers, BEGIN


class PanelPatchTests(unittest.TestCase):
    def test_idempotent_patch_uses_current_store_and_preserves_panel(self):
        original='<html><script type="module">const authFixture={};typeof window<`u`&&(window.addEventListener(`unauthorized`,()=>{authFixture.getState().logout()}));</script><body>Original panel</body></html>'
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'static/management.html';path.parent.mkdir();path.write_text(original)
            self.assertTrue(patch_panel(path))
            updated=path.read_text()
            self.assertEqual(updated.count(BEGIN),1)
            self.assertIn('})(authFixture, null);',updated)
            self.assertIn('<body>Original panel</body>',updated)
            self.assertNotIn('__CPA_AUTH_STORE__',updated)
            self.assertFalse(patch_panel(path))
            self.assertEqual(path.read_text(),updated)
            self.assertTrue((Path(temporary)/'backups/management.before-usage-integration.html.gz').is_file())

    def test_reapply_after_updater_overwrites_panel(self):
        original='<script type="module">typeof window<`u`&&(window.addEventListener(`unauthorized`,()=>{firstStore.getState().logout()}));</script>'
        replacement=original.replace('firstStore', 'updatedStore')
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'static/management.html';path.parent.mkdir();path.write_text(original)
            patch_panel(path)
            saved=Path(temporary)/'backups/management.before-usage-integration.html.gz'
            backup=saved.read_bytes()
            path.write_text(replacement)
            self.assertTrue(patch_panel(path))
            self.assertIn('})(updatedStore, null);',path.read_text())
            self.assertEqual(path.read_text().count(BEGIN),1)
            self.assertEqual(saved.read_bytes(),backup)
            self.assertFalse(patch_panel(path))

    def test_unknown_build_is_not_modified(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'management.html';path.write_text('<html>Unknown panel</html>')
            with self.assertRaises(ValueError):patch_panel(path)
            self.assertEqual(path.read_text(),'<html>Unknown panel</html>')

    def test_panel_name_helpers_are_detected_without_fixed_minified_names(self):
        source='''var labelPrefix=`api-key-names:v1:`;
function digestLabel(base,key){let payload=JSON.stringify([`api-key-name`,base,key]);return digest(payload)}
function readLabel(base){try{let saved=storage.getItem(labelPrefix+base);return saved}catch{return{}}}
typeof window<`u`&&(window.addEventListener(`unauthorized`,()=>{authFixture.getState().logout()}));'''
        self.assertEqual(name_helpers(source),'{read:readLabel,hash:digestLabel}')
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'management.html';path.write_text(source)
            patch_panel(path,backup=False)
            self.assertIn('})(authFixture, {read:readLabel,hash:digestLabel});',path.read_text())
            self.assertFalse(patch_panel(path,backup=False))


if __name__=='__main__':unittest.main()
