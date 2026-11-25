import type { UIExtension } from '@crowbartools/firebot-types';
import page from './giveaways.html';
import { rendererExpression } from '../utility/renderer-callback';
import { controller as configurationController } from '../effects/main-controller';
import { configurationTemplate } from '../effects/main-effect';
import { pageController } from './page-controller';
const componentController = rendererExpression(
    new Function(
        `return function($scope,backendCommunicator,utilityService){this.$onInit=()=>{$scope.configurationContext='page';$scope.silentRequestErrors=true;$scope.effect=this.model;(${configurationController.toString()})($scope,backendCommunicator,utilityService);};}`,
    )(),
);
const fileDirective = () => ({
    restrict: 'A',
    scope: { onTemplateFile: '&' },
    link: (scope: any, element: any) => {
        let closed = false,
            sequence = 0;
        const change = async () => {
            const current = ++sequence,
                file = element[0].files?.[0];
            if (!file) return;
            try {
                if (file.size > 50 * 1024 * 1024) throw new Error('Template file exceeds 50 MiB');
                const text = await file.text();
                if (!closed && current === sequence) scope.$evalAsync(() => scope.onTemplateFile({ text }));
            } catch (e: any) {
                if (!closed) scope.$evalAsync(() => scope.onTemplateFile({ fileError: e.message }));
            } finally {
                element[0].value = '';
            }
        };
        element.on('change', change);
        scope.$on('$destroy', () => {
            closed = true;
            element.off('change', change);
        });
    },
});
export const giveawayUi: UIExtension = {
    id: 'msgg-giveaway-system',
    pages: [
        {
            id: 'giveaways',
            name: 'Giveaways',
            icon: 'fa-gift',
            type: 'angularjs',
            template: page,
            controller: pageController,
        },
    ],
    providers: {
        components: [
            {
                name: 'msggGiveawayConfiguration',
                bindings: { model: '=' },
                template: configurationTemplate,
                controller: componentController,
            },
        ],
        directives: [{ name: 'msggTemplateFile', function: fileDirective }],
    },
};
