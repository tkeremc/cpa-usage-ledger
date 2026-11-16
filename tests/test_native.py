import base64
import ctypes as C
import importlib
import json
import os
import platform
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
engine=importlib.import_module('cpa_usage_ledger.plugin')

class Buffer(C.Structure):
    _fields_=[('ptr',C.c_void_p),('len',C.c_size_t)]
Call=C.CFUNCTYPE(C.c_int,C.c_char_p,C.POINTER(C.c_uint8),C.c_size_t,C.POINTER(Buffer))
Free=C.CFUNCTYPE(None,C.c_void_p,C.c_size_t)
Shutdown=C.CFUNCTYPE(None)
class Host(C.Structure):
    _fields_=[('abi_version',C.c_uint32),('host_ctx',C.c_void_p),('call',C.c_void_p),('free_buffer',C.c_void_p)]
class Plugin(C.Structure):
    _fields_=[('abi_version',C.c_uint32),('call',Call),('free_buffer',Free),('shutdown',Shutdown)]


class NativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        arch={'x86_64':'amd64','aarch64':'arm64'}[platform.machine()]
        cls.library=C.CDLL(os.environ.get('CPA_USAGE_TEST_LIBRARY', str(ROOT/'dist/linux'/arch/'cpa-usage-ledger.so')))
        cls.init=cls.library.cliproxy_plugin_init
        cls.init.argtypes=[C.POINTER(Host),C.POINTER(Plugin)]
        cls.init.restype=C.c_int

    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        engine.STATE=Path(self.tmp.name)
        engine._ledger=None
        self.plugin=Plugin()
        self.assertEqual(self.init(C.byref(Host(1,None,None,None)),C.byref(self.plugin)),0)

    def tearDown(self):
        self.plugin.shutdown()
        engine._ledger=None
        self.tmp.cleanup()

    def call(self, method, value=None):
        raw=json.dumps(value or {}).encode()
        data=(C.c_uint8*len(raw)).from_buffer_copy(raw)
        result=Buffer()
        code=self.plugin.call(method.encode(),data,len(raw),C.byref(result))
        try:
            payload=json.loads(C.string_at(result.ptr,result.len))
        finally:self.plugin.free_buffer(result.ptr,result.len)
        self.assertEqual(code,0)
        return payload

    def native_record(self, key='fixture-client-key'):
        return dict(Provider='claude',Model='fixture-text',Alias='daily',APIKey=key,IsNativeKey=True,
                    AuthIndex='account-1',AuthType='oauth',RequestedAt='2026-11-16T12:00:00Z',
                    RequestID='execution-a',TraceID='trace-a',Latency=1_250_000_000,TTFT=120_000_000,
                    Failed=False,Stream=True,Detail={'InputTokens':100,'OutputTokens':40,'CachedTokens':60,'ReasoningTokens':10,'TotalTokens':140},
                    Failure={'StatusCode':200,'Body':'sensitive-failure-body'},ResponseHeaders={'Secret':'private-header'})

    def management(self,path,verb='GET',query=None,body=None):
        request={'Method':verb,'Path':path,'Query':query or {}}
        if body is not None:request['Body']=base64.b64encode(json.dumps(body).encode()).decode()
        result=self.call('management.handle',request)['result']
        data=base64.b64decode(result['Body'])
        return result['StatusCode'],data

    def test_actual_abi_registration_and_resource_menu(self):
        result=self.call('plugin.register')['result']
        self.assertTrue(result['capabilities']['usage_plugin'])
        self.assertTrue(result['capabilities']['management_api'])
        self.assertEqual(result['metadata']['GitHubRepository'], 'https://github.com/tkeremc/cpa-usage-ledger')
        self.assertEqual(self.call('plugin.reconfigure')['result']['metadata']['Name'],'CPA Usage Ledger')
        registration=self.call('management.register')['result']
        self.assertEqual(registration['Resources'][0]['Menu'],'Usage history')
        self.assertEqual(self.plugin.abi_version,1)

    def test_native_observer_accounting_privacy_and_export(self):
        self.call('plugin.register')
        self.assertTrue(self.call('usage.handle',{'record':self.native_record()})['ok'])
        status,data=self.management(engine.API+'/report')
        report=json.loads(data)
        self.assertEqual(status,200)
        self.assertEqual(report['summary']['total_tokens'],140)
        self.assertEqual(report['summary']['avg_latency_ms'],1250)
        self.assertEqual(report['groups'][0]['known'],1)
        self.assertEqual(report['events'][0]['metadata']['ttft_ms'],120)
        for secret in ('fixture-client-key','private-header','sensitive-failure-body'):
            self.assertNotIn(secret.encode(),data)
        status,csv=self.management(engine.API+'/export.csv')
        self.assertEqual(status,200)
        self.assertNotIn(b'fixture-client-key',csv)

    def test_direct_record_and_multiple_client_keys(self):
        self.call('usage.handle',self.native_record('fixture-a'))
        self.call('usage.handle',{'Record':self.native_record('fixture-b')})
        _,data=self.management(engine.API+'/report')
        self.assertEqual(len(json.loads(data)['groups']),2)

    def test_native_key_rename(self):
        self.call('usage.handle',self.native_record())
        key_id=engine.ledger().fingerprint('fixture-client-key')
        status,_=self.management(engine.API+'/key-name','POST',body={'key_id':key_id,'name':'My application'})
        self.assertEqual(status,200)
        _,data=self.management(engine.API+'/report',query={'key_id':[key_id]})
        self.assertEqual(json.loads(data)['groups'][0]['name'],'My application')

    def test_public_resources_do_not_expose_private_report(self):
        self.call('usage.handle',self.native_record())
        for name in ('index.html','app.js','session.js','style.css'):
            status,data=self.management(engine.RESOURCE+name)
            self.assertEqual(status,200)
            self.assertNotIn(b'fixture-client-key',data)
        status,_=self.management(engine.RESOURCE+'report')
        self.assertEqual(status,404)
        status,_=self.management(engine.RESOURCE+'../ledger.py')
        self.assertEqual(status,404)

    def test_invalid_abi_rejected(self):
        plugin=Plugin()
        self.assertEqual(self.init(C.byref(Host(999,None,None,None)),C.byref(plugin)),1)

    def test_failed_native_record_and_invalid_filters(self):
        record=self.native_record()
        record['Failed']=True;record['Failure']['StatusCode']=429
        self.call('usage.handle',record)
        _,data=self.management(engine.API+'/report',query={'status':['failed']})
        self.assertEqual(json.loads(data)['summary']['failed'],1)
        status,_=self.management(engine.API+'/report',query={'from':['2026-11-17'],'to':['2026-11-16']})
        self.assertEqual(status,400)

if __name__=='__main__':unittest.main()
