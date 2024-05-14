import {
  type InternalContext,
  getChainUtils as getBaseChainUtils,
} from '@rsbuild/core/internal';
import {
  type BundlerChain,
  type ModifyWebpackChainUtils,
  type ModifyWebpackConfigUtils,
  type RsbuildTarget,
  type WebpackChain,
  castArray,
  chainToConfig,
  debug,
  mergeChainedOptions,
  modifyBundlerChain,
} from '@rsbuild/shared';
import type { RuleSetRule, WebpackPluginInstance } from 'webpack';
import { getCompiledPath } from './shared';
import type { WebpackConfig } from './types';

async function modifyWebpackChain(
  context: InternalContext,
  utils: ModifyWebpackChainUtils,
  chain: WebpackChain,
): Promise<WebpackChain> {
  debug('modify webpack chain');

  const [modifiedChain] = await context.hooks.modifyWebpackChain.call(
    chain,
    utils,
  );

  if (context.config.tools?.webpackChain) {
    for (const item of castArray(context.config.tools.webpackChain)) {
      item(modifiedChain, utils);
    }
  }

  debug('modify webpack chain done');

  return modifiedChain;
}

async function modifyWebpackConfig(
  context: InternalContext,
  webpackConfig: WebpackConfig,
  utils: ModifyWebpackConfigUtils,
): Promise<WebpackConfig> {
  debug('modify webpack config');
  let [modifiedConfig] = await context.hooks.modifyWebpackConfig.call(
    webpackConfig,
    utils,
  );

  if (context.config.tools?.webpack) {
    modifiedConfig = mergeChainedOptions({
      defaults: modifiedConfig,
      options: context.config.tools.webpack,
      utils,
      mergeFn: utils.mergeConfig,
    });
  }

  debug('modify webpack config done');
  return modifiedConfig;
}

async function getChainUtils(
  target: RsbuildTarget,
): Promise<ModifyWebpackChainUtils> {
  const { default: webpack } = await import('webpack');
  const { getHTMLPlugin } = await import('@rsbuild/core/internal');
  const nameMap = {
    web: 'client',
    node: 'server',
    'web-worker': 'web-worker',
    'service-worker': 'service-worker',
  };

  return {
    ...getBaseChainUtils(target),
    name: nameMap[target] || '',
    webpack,
    getCompiledPath,
    HtmlWebpackPlugin: getHTMLPlugin(),
  };
}

async function getConfigUtils(
  config: WebpackConfig,
  chainUtils: ModifyWebpackChainUtils,
): Promise<ModifyWebpackConfigUtils> {
  const { merge } = await import('@rsbuild/shared/webpack-merge');

  return {
    ...chainUtils,

    mergeConfig: merge,

    addRules(rules: RuleSetRule | RuleSetRule[]) {
      const ruleArr = castArray(rules);
      if (!config.module) {
        config.module = {};
      }
      if (!config.module.rules) {
        config.module.rules = [];
      }
      config.module.rules.unshift(...ruleArr);
    },

    prependPlugins(plugins: WebpackPluginInstance | WebpackPluginInstance[]) {
      const pluginArr = castArray(plugins);
      if (!config.plugins) {
        config.plugins = [];
      }
      config.plugins.unshift(...pluginArr);
    },

    appendPlugins(plugins: WebpackPluginInstance | WebpackPluginInstance[]) {
      const pluginArr = castArray(plugins);
      if (!config.plugins) {
        config.plugins = [];
      }
      config.plugins.push(...pluginArr);
    },

    removePlugin(pluginName: string) {
      if (config.plugins) {
        config.plugins = config.plugins.filter(
          (item) => item?.constructor.name !== pluginName,
        );
      }
    },
  };
}

export async function generateWebpackConfig({
  target,
  context,
}: {
  target: RsbuildTarget;
  context: InternalContext;
}) {
  const chainUtils = await getChainUtils(target);
  const { default: webpack } = await import('webpack');
  const {
    BannerPlugin,
    DefinePlugin,
    IgnorePlugin,
    ProvidePlugin,
    HotModuleReplacementPlugin,
  } = webpack;

  const bundlerChain = await modifyBundlerChain(context, {
    ...chainUtils,
    bundler: {
      BannerPlugin,
      DefinePlugin,
      IgnorePlugin,
      ProvidePlugin,
      HotModuleReplacementPlugin,
    },
  });

  const chain = await modifyWebpackChain(
    context,
    chainUtils,
    // module rules not support merge
    // need a special rule merge or use bundlerChain as WebpackChain
    bundlerChain as unknown as WebpackChain,
  );

  let webpackConfig = chainToConfig(
    chain as unknown as BundlerChain,
  ) as WebpackConfig;

  webpackConfig = await modifyWebpackConfig(
    context,
    webpackConfig,
    await getConfigUtils(webpackConfig, chainUtils),
  );

  return webpackConfig;
}
