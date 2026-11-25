// Firebot v5.67.0 (GPL-3.0), unchanged below.
// https://github.com/crowbartools/Firebot/blob/v5.67.0/src/gui/app/directives/effect-option-settings/eosContainer.js
"use strict";

(function() {
    angular.module("firebotApp").component("eosContainer", {
        bindings: {
            header: "@",
            padTop: "<"
        },
        transclude: true,
        template: `
            <div class="effect-setting-container" ng-class="{ 'setting-padtop' : $ctrl.padTop }">
                <div class="effect-specific-title" ng-if="$ctrl.header">
                    <h4>{{$ctrl.header}}</h4>
                </div>
                <div class="effect-setting-content" ng-transclude></div>
            </div>
        `
    });
}());
