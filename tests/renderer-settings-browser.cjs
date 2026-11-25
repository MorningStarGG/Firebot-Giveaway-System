const assert = require('node:assert/strict');
// Same backend preparation used by Firebot 5.67 UIExtensionManager.prepareFunc.
const prepareFunc = (func, name) => func.toString().replace(/^[\s]*function[\s]*\(/, 'function ' + name + '(');
const rawExtension = (extension) => ({
    id: extension.id,
    pages: extension.pages.map((page) => ({
        ...page,
        controller: undefined,
        controllerRaw: prepareFunc(page.controller, 'pageCtrl'),
    })),
    providers: {
        directives: (extension.providers.directives || []).map((d) => ({
            ...d,
            function: undefined,
            functionRaw: prepareFunc(d.function, 'directiveCtrl'),
        })),
        components: extension.providers.components.map((component) => ({
            ...component,
            controller: undefined,
            controllerRaw: prepareFunc(component.controller, 'componentCtrl'),
        })),
    },
});
const serialize = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
exports.page = (
    effects,
    extension,
) => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/test/bootstrap.v5.67.0.css"><style>
/* Layout rules from Firebot v5.67.0 _controls.scss, _global.scss and _bootstrap-overrides.scss (GPL-3.0); theme colors omitted. */
.effect-setting-content{padding-left:25px;padding-right:15px}.setting-padtop{padding-top:20px;display:block}
.form-control{height:40px;border-width:2px;border-radius:10px;box-shadow:none}.input-group-addon{border-width:2px;border-radius:8px}
textarea.form-control{resize:vertical;padding-top:9px;min-height:40px}textarea.form-control.single-line-textarea{height:40px;scrollbar-width:none;scrollbar-color:transparent transparent}
.input-group>textarea.form-control{float:left!important}label{font-size:15px;font-weight:400}.btn{border-radius:10px;padding:9px 12px}
.control-fb{display:block;position:relative;padding-left:30px;margin-bottom:15px;cursor:pointer;font-size:15px;font-weight:400}
.control-fb input{position:absolute;z-index:-1;opacity:0}.control__indicator{position:absolute;top:0;left:0;height:20px;width:20px;background:#e6e6e6;border-radius:8px}
.controls-fb-inline .control-fb{display:inline-block;padding-right:25px;margin-bottom:5px}
/* Test host and a sized stand-in for the third-party color popup. */
#settings-host{padding:20px}.test-effect-editor{width:760px;max-width:100%}color-picker{display:table-cell;width:100%}
</style></head><body><div id="settings-host"></div>
<script src="/test/angular.js"></script><script>
window.settingsErrors=[];window.requests=[];window.replyDelay=0;window.confirmResult=false;
const listeners=new Map();window.require=name=>{if(name==='crypto')return{randomUUID:()=>crypto.randomUUID()};throw Error('Unexpected require '+name)};
window.ipcRenderer={on:(name,callback)=>{if(listeners.has(name))throw Error('Duplicate IPC listener');listeners.set(name,callback)},send:(name,packet)=>{
 if(name.endsWith(':reply'))return;if(name!=='msgg:giveaway:request')throw Error('Unexpected channel '+name);window.requests.push(packet);
 const wait=typeof window.replyDelay==='function'?window.replyDelay(packet):window.replyDelay;
 fetch('/test/ipc',{method:'POST',body:JSON.stringify(packet)}).then(r=>r.json()).then(reply=>setTimeout(()=>{for(const change of reply.notifications||[])listeners.get('msgg:giveaway:changed')?.({},change);listeners.get('msgg:giveaway:reply')({},reply);},wait)).catch(e=>window.settingsErrors.push(String(e)));
}};
const app=angular.module('firebotApp',[]).config(function($compileProvider,$provide,$filterProvider){window.ngProviders={$compileProvider,$provide,$filterProvider};}).value('dynamicParameterRegistry',{register(){}}).value('settingsService',{getSetting:name=>name==='OverlayInstances'?['Elsewhere']:name==='UseOverlayInstances'}).value('utilityService',{showOverlayInfoModal(){},showInfoModal(){},showErrorModal(){},showConfirmationModal(){return Promise.resolve(window.confirmResult)}}).factory('$exceptionHandler',()=>error=>window.settingsErrors.push(String(error)));
app.component('colorPicker',{bindings:{ngModel:'='},template:'<input class="form-control" ng-model="$ctrl.ngModel" aria-label="Color value">'});
</script><script src="/test/backend-communicator.js"></script><script src="/test/firebot-input.js"></script>
<script src="/test/eos-container.v5.67.0.js"></script><script src="/test/firebot-radios.v5.67.0.js"></script>
<script src="/test/ui-extensions.v5.67.0.js"></script><script src="/test/angularjs-extension-page-content.v5.67.0.js"></script>
<script src="/test/color-picker-input.v5.67.0.js"></script><script src="/test/eos-overlay-position.v5.67.0.js"></script><script src="/test/eos-overlay-instance.v5.67.0.js"></script><script>
(async()=>{try{
 const definitions=${serialize(effects.map((e) => ({ controller: e.optionsController.toString(), validator: e.optionsValidator.toString(), template: e.optionsTemplate })))};
 const rawUi=${serialize(rawExtension(extension))};
 const injector=angular.bootstrap(document.getElementById('settings-host'),['firebotApp']),root=injector.get('$rootScope'),compile=injector.get('$compile');
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const uiService=injector.get('uiExtensionsService');listeners.get('ui-extensions:all-ui-extensions')({},[rawUi]);root.$digest();
 const ui=uiService.getPage(rawUi.id,rawUi.pages[0].id);
 const openPage=()=>{const parent=root.$new();parent.page=ui;const holder=angular.element('<div><angularjs-extension-page-content page="page"></angularjs-extension-page-content></div>');angular.element(document.getElementById('settings-host')).append(holder);compile(holder)(parent);root.$digest();const element=holder[0].querySelector('.msgg-giveaway-page');const scope=angular.element(element).scope();return{scope,element,close(){parent.$destroy();holder.remove();}};};
 const open=(definition,effect)=>{const scope=root.$new();scope.effect=effect;const fn=eval('('+definition.controller+')');injector.invoke(fn,{},{$scope:scope});const element=compile('<div class="test-effect-editor">'+definition.template+'</div>')(scope);angular.element(document.getElementById('settings-host')).append(element);root.$digest();return{scope,element,close(){scope.$destroy();element.remove()}}};
 for(let n=0;n<3;n++){
  const main=open(definitions[0],{giveawayTitle:'Alpha',styles:{accentColor:'blue'},giveawayOptions:{displayDuration:0,winLimit:{maximum:2,scope:'all',period:'rolling',days:7}}});await delay(70);root.$digest();
  if(main.scope.effect.styles.accentColor!=='blue'||main.scope.effect.giveawayOptions.displayDuration!==0||main.scope.effect.giveawayOptions.winLimit.maximum!==2)throw Error('Saved Create values replaced');
  if(typeof eval('('+definitions[0].validator+')')!=='function')throw Error('Validator serialization');main.close();
  const manager=open(definitions[1],{giveawayTitle:'giveaway_Alpha',giveawaySelectionMode:'giveawayList',mode:'updateStyles',styles:{accentColor:'blue'},setting:{type:'accentColor',value:'KEEP'},giveawayOptions:{requeueDenied:false}});await delay(80);root.$digest();
  if(manager.scope.effect.styles.accentColor!=='blue'||manager.scope.effect.setting.value!=='KEEP'||manager.scope.effect.giveawayOptions.requeueDenied!==false)throw Error('Saved Manager action replaced');
  for(const mode of ['entryManagement','toggleVisibility','updateDisplay','updatePosition','updateStyles','updateText','giveawayStatusControl','winnerHistory','updatePolicy','resetWinCounts']){manager.scope.effect.mode=mode;root.$digest();await delay(5);}manager.close();
  const attempt=open(definitions[1],{mode:'entryManagement',entryAction:'cancelAttempt',entryAttemptId:'$eventMeta[entryAttemptId]',cancellationReason:'Saved explanation',oddsMultiplier:4});await delay(70);root.$digest();
  const has=selector=>!!attempt.element[0].querySelector(selector);
  if(!has('firebot-input[model="effect.entryAttemptId"]')||!has('firebot-input[model="effect.cancellationReason"]'))throw Error('Attempt controls missing');
  if(has('select[ng-model="effect.giveawayTitle"]')||has('firebot-input[model="effect.username"]'))throw Error('Attempt controls require an unrelated giveaway or username');
  if(attempt.scope.effect.entryAttemptId!=='$eventMeta[entryAttemptId]'||attempt.scope.effect.cancellationReason!=='Saved explanation')throw Error('Saved attempt controls overwritten');
  attempt.scope.effect.entryAction='setAttemptOdds';root.$digest();
  if(!has('firebot-input[model="effect.oddsMultiplier"]')||has('firebot-input[model="effect.cancellationReason"]')||attempt.scope.effect.oddsMultiplier!==4)throw Error('Attempt odds controls incorrect');
  attempt.close();
  const backup=open(definitions[2],{giveawaySelectionMode:'giveawayList'});await delay(40);const before=window.requests.length;await backup.scope.restoreGiveaway('giveaway_Alpha::backup::missing');if(window.requests.slice(before).some(r=>r.action==='restoreGiveaway'))throw Error('Cancel restored backup');backup.close();
 }
 window.checkFormLayout=()=>(${require('./browser-form-layout.cjs').toString()})({openPage,open,definitions,root});
 window.formLayoutChecks=[await window.checkFormLayout()];
 await (${require('./browser-management.cjs').toString()})({openPage,open,definitions,root,delay,baselineTemplate:${serialize(require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures/giveaway-form.before-sections.html'), 'utf8'))}});
}catch(error){window.settingsErrors.push(String(error))}window.settingsDone=true})();
</script></body></html>`;
exports.verify = async ({ send, evaluate, until, address }) => {
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: address + '/test/settings.html' });
    await until(() => evaluate('window.settingsDone===true'), 'settings tests');
    assert.deepEqual(await evaluate('window.settingsErrors'), [], 'Angular editor or management UI errors');
    await send('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate('window.checkFormLayout().then(result=>window.formLayoutChecks.push(result))');
    await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
    console.log('Form layout:', await evaluate('window.formLayoutChecks'));
    console.log('Form loading:', await evaluate('window.formBenchmark'));
    console.log(
        'Renderer passed: released Firebot UI loader/page directive/overlay controls, defaults, tab clicks, giveaway switching, history rendering/input/search, saved effect values, native management actions, cancellation, and disposal.',
    );
};
