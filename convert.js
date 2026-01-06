/*
hazicy 的 Substore 订阅转换脚本
https://github.com/hazicy/override-rules

支持的传入参数：
- loadbalance: 启用负载均衡（url-test/load-balance，默认 false）
- landing: 启用落地节点功能（如机场家宽/星链/落地分组，默认 false）
- ipv6: 启用 IPv6 支持（默认 false）
- full: 输出完整配置（适合纯内核启动，默认 false）
- keepalive: 启用 tcp-keep-alive（默认 false）
- fakeip: DNS 使用 FakeIP 模式（默认 false，false 为 RedirHost）
- quic: 允许 QUIC 流量（UDP 443，默认 false）
- threshold: 国家节点数量小于该值时不显示分组 (默认 0)
*/

const NODE_SUFFIX = '节点';

function parseBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return false;
}

function parseNumber(value, defaultValue = 0) {
  if (value === null || typeof value === 'undefined') {
    return defaultValue;
  }
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

/**
 * 解析传入的脚本参数，并将其转换为内部使用的功能开关（feature flags）。
 * @param {object} args - 传入的原始参数对象，如 $arguments。
 * @returns {object} - 包含所有功能开关状态的对象。
 *
 * 该函数通过一个 `spec` 对象定义了外部参数名（如 `loadbalance`）到内部变量名（如 `loadBalance`）的映射关系。
 * 它会遍历 `spec` 中的每一项，对 `args` 对象中对应的参数值调用 `parseBool` 函数进行布尔化处理，
 * 并将结果存入返回的对象中。
 */
function buildFeatureFlags(args) {
  const spec = {
    loadbalance: 'loadBalance',
    landing: 'landing',
    ipv6: 'ipv6Enabled',
    full: 'fullConfig',
    keepalive: 'keepAliveEnabled',
    fakeip: 'fakeIPEnabled',
    quic: 'quicEnabled',
  };

  const flags = Object.entries(spec).reduce((acc, [sourceKey, targetKey]) => {
    acc[targetKey] = parseBool(args[sourceKey]) || false;
    return acc;
  }, {});

  // 单独处理数字参数
  flags.countryThreshold = parseNumber(args.threshold, 0);

  return flags;
}

const rawArgs = typeof $arguments !== 'undefined' ? $arguments : {};
const {
  loadBalance,
  landing,
  ipv6Enabled,
  fullConfig,
  keepAliveEnabled,
  fakeIPEnabled,
  quicEnabled,
  countryThreshold,
} = buildFeatureFlags(rawArgs);

function getCountryGroupNames(countryInfo, minCount) {
  return countryInfo
    .filter((item) => item.count >= minCount)
    .map((item) => item.country + NODE_SUFFIX);
}

function stripNodeSuffix(groupNames) {
  const suffixPattern = new RegExp(`${NODE_SUFFIX}$`);
  return groupNames.map((name) => name.replace(suffixPattern, ''));
}

const PROXY_GROUPS = {
  SELECT: '选择代理',
  MANUAL: '手动选择',
  FALLBACK: '故障转移',
  DIRECT: '直连',
  LANDING: '落地节点',
  LOW_COST: '低倍率节点',
};

// 辅助函数，用于根据条件构建数组，自动过滤掉无效值（如 false, null）
const buildList = (...elements) => elements.flat().filter(Boolean);

function buildBaseLists({ landing, lowCost, countryGroupNames }) {
  // 使用辅助函数和常量，以声明方式构建各个代理列表

  // “选择节点”组的候选列表
  const defaultSelector = buildList(
    PROXY_GROUPS.FALLBACK,
    landing && PROXY_GROUPS.LANDING,
    countryGroupNames,
    lowCost && PROXY_GROUPS.LOW_COST,
    PROXY_GROUPS.MANUAL,
    'DIRECT',
  );

  // 默认的代理列表，用于大多数策略组
  const defaultProxies = buildList(
    PROXY_GROUPS.SELECT,
    countryGroupNames,
    lowCost && PROXY_GROUPS.LOW_COST,
    PROXY_GROUPS.MANUAL,
    PROXY_GROUPS.DIRECT,
  );

  // “直连”优先的代理列表
  const defaultProxiesDirect = buildList(
    PROXY_GROUPS.DIRECT,
    countryGroupNames,
    lowCost && PROXY_GROUPS.LOW_COST,
    PROXY_GROUPS.SELECT,
    PROXY_GROUPS.MANUAL,
  );

  // “故障转移”组的代理列表
  const defaultFallback = buildList(
    landing && PROXY_GROUPS.LANDING,
    countryGroupNames,
    lowCost && PROXY_GROUPS.LOW_COST,
    PROXY_GROUPS.MANUAL,
    'DIRECT',
  );

  return {
    defaultProxies,
    defaultProxiesDirect,
    defaultSelector,
    defaultFallback,
  };
}

const ruleProviders = {
  'fakeip-filter': {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/fakeip-filter.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/fakeip-filter.mrs',
    interval: 86400,
  },
  private: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/private.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/private.mrs',
    interval: 86400,
  },
  ads: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/ads.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/ads.mrs',
    interval: 86400,
  },
  trackerslist: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/trackerslist.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/trackerslist.mrs',
    interval: 86400,
  },
  applications: {
    type: 'http',
    behavior: 'classical',
    format: 'text',
    path: './ruleset/applications.list',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/applications.list',
    interval: 86400,
  },
  'microsoft-cn': {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/microsoft-cn.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/microsoft-cn.mrs',
    interval: 86400,
  },
  'apple-cn': {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/apple-cn.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/apple-cn.mrs',
    interval: 86400,
  },
  'google-cn': {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/google-cn.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/google-cn.mrs',
    interval: 86400,
  },
  'games-cn': {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/games-cn.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/games-cn.mrs',
    interval: 86400,
  },
  netflix: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/netflix.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/netflix.mrs',
    interval: 86400,
  },
  disney: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/disney.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/disney.mrs',
    interval: 86400,
  },
  max: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/max.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/max.mrs',
    interval: 86400,
  },
  primevideo: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/primevideo.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/primevideo.mrs',
    interval: 86400,
  },
  appletv: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/appletv.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/appletv.mrs',
    interval: 86400,
  },
  youtube: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/youtube.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/youtube.mrs',
    interval: 86400,
  },
  tiktok: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/tiktok.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/tiktok.mrs',
    interval: 86400,
  },
  bilibili: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/bilibili.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/bilibili.mrs',
    interval: 86400,
  },
  spotify: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/spotify.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/spotify.mrs',
    interval: 86400,
  },
  media: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/media.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/media.mrs',
    interval: 86400,
  },
  games: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/games.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/games.mrs',
    interval: 86400,
  },
  ai: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/ai.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/ai.mrs',
    interval: 86400,
  },
  networktest: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/networktest.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/networktest.mrs',
    interval: 86400,
  },
  'tld-proxy': {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/tld-proxy.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/tld-proxy.mrs',
    interval: 86400,
  },
  gfw: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/gfw.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/gfw.mrs',
    interval: 86400,
  },
  cn: {
    type: 'http',
    behavior: 'domain',
    format: 'mrs',
    path: './ruleset/cn.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/cn.mrs',
    interval: 86400,
  },
  privateip: {
    type: 'http',
    behavior: 'ipcidr',
    format: 'mrs',
    path: './ruleset/privateip.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/privateip.mrs',
    interval: 86400,
  },
  cnip: {
    type: 'http',
    behavior: 'ipcidr',
    format: 'mrs',
    path: './ruleset/cnip.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/cnip.mrs',
    interval: 86400,
  },
  netflixip: {
    type: 'http',
    behavior: 'ipcidr',
    format: 'mrs',
    path: './ruleset/netflixip.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/netflixip.mrs',
    interval: 86400,
  },
  mediaip: {
    type: 'http',
    behavior: 'ipcidr',
    format: 'mrs',
    path: './ruleset/mediaip.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/mediaip.mrs',
    interval: 86400,
  },
  gamesip: {
    type: 'http',
    behavior: 'ipcidr',
    format: 'mrs',
    path: './ruleset/gamesip.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/gamesip.mrs',
    interval: 86400,
  },
  telegramip: {
    type: 'http',
    behavior: 'ipcidr',
    format: 'mrs',
    path: './ruleset/telegramip.mrs',
    url: 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/telegramip.mrs',
    interval: 86400,
  },
};

const baseRules = [
  'RULE-SET,private,🔒 私有网络',
  'RULE-SET,ads,🛑 广告域名',
  'RULE-SET,trackerslist,📋 Trackerslist',
  'RULE-SET,applications,⬇️ 直连软件',
  'RULE-SET,microsoft-cn,🪟 微软服务',
  'RULE-SET,apple-cn,🍎 苹果服务',
  'RULE-SET,google-cn,🇬 谷歌服务',
  'RULE-SET,games-cn,🎮 游戏服务',
  'RULE-SET,netflix,🎥 奈飞视频',
  'RULE-SET,disney,📽️ 迪士尼+',
  'RULE-SET,max,🎞️ Max',
  'RULE-SET,primevideo,🎬 Prime Video',
  'RULE-SET,appletv,🍎 Apple TV+',
  'RULE-SET,youtube,📹 油管视频',
  'RULE-SET,tiktok,🎵 TikTok',
  'RULE-SET,bilibili,📺 哔哩哔哩',
  'RULE-SET,spotify,🎶 Spotify',
  'RULE-SET,media,🌍 国外媒体',
  'RULE-SET,games,🎮 游戏平台',
  'RULE-SET,ai,🤖 AI 平台',
  'RULE-SET,networktest,📈 网络测试',
  'RULE-SET,tld-proxy,🧱 代理顶级域名',
  'RULE-SET,gfw,🧱 代理域名',
  'RULE-SET,cn,🛡️ 直连域名',
  'RULE-SET,privateip,🔒 私有网络,no-resolve',
  'RULE-SET,cnip,🀄️ 直连 IP',
  'RULE-SET,netflixip,🎥 奈飞视频',
  'RULE-SET,mediaip,🌍 国外媒体',
  'RULE-SET,gamesip,🎮 游戏平台',
  'RULE-SET,telegramip,📲 电报消息,no-resolve',
  'MATCH,🐟 漏网之鱼',
];

function buildRules({ quicEnabled }) {
  const ruleList = [...baseRules];
  if (!quicEnabled) {
    // 屏蔽 QUIC 流量，避免网络环境 UDP 速度不佳时影响体验
    ruleList.unshift('AND,((DST-PORT,443),(NETWORK,UDP)),REJECT');
  }
  return ruleList;
}

const snifferConfig = {
  sniff: {
    TLS: {
      ports: [443, 8443],
    },
    HTTP: {
      ports: [80, 8080, 8880],
    },
    QUIC: {
      ports: [443, 8443],
    },
  },
  'override-destination': false,
  enable: true,
  'force-dns-mapping': true,
  'skip-domain': ['Mijia Cloud', 'dlg.io.mi.com', '+.push.apple.com'],
};

function buildDnsConfig({ mode, fakeIpFilter }) {
  const config = {
    enable: true,
    ipv6: ipv6Enabled,
    'prefer-h3': true,
    'enhanced-mode': mode,
    'default-nameserver': ['119.29.29.29', '223.5.5.5'],
    nameserver: ['system', '223.5.5.5', '119.29.29.29', '180.184.1.1'],
    fallback: [
      'quic://dns0.eu',
      'https://dns.cloudflare.com/dns-query',
      'https://dns.sb/dns-query',
      'tcp://208.67.222.222',
      'tcp://8.26.56.2',
    ],
    'proxy-server-nameserver': [
      'https://dns.alidns.com/dns-query',
      'tls://dot.pub',
    ],
  };

  if (fakeIpFilter) {
    config['fake-ip-filter'] = fakeIpFilter;
  }

  return config;
}

const dnsConfig = buildDnsConfig({ mode: 'redir-host' });
const dnsConfigFakeIp = buildDnsConfig({
  mode: 'fake-ip',
  fakeIpFilter: [
    'geosite:private',
    'geosite:connectivity-check',
    'geosite:cn',
    'Mijia Cloud',
    'dig.io.mi.com',
    'localhost.ptlogin2.qq.com',
    '*.icloud.com',
    '*.stun.*.*',
    '*.stun.*.*.*',
  ],
});

const geoxURL = {
  geoip:
    'https://gcore.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geoip.dat',
  geosite:
    'https://gcore.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geosite.dat',
  mmdb: 'https://gcore.jsdelivr.net/gh/Loyalsoldier/geoip@release/Country.mmdb',
  asn: 'https://gcore.jsdelivr.net/gh/Loyalsoldier/geoip@release/GeoLite2-ASN.mmdb',
};

// 地区元数据
const countriesMeta = {
  香港: {
    pattern: '香港|港|HK|hk|Hong Kong|HongKong|hongkong|🇭🇰',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Hong_Kong.png',
  },
  澳门: {
    pattern: '澳门|MO|Macau|🇲🇴',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Macao.png',
  },
  台湾: {
    pattern: '台|新北|彰化|TW|Taiwan|🇹🇼',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Taiwan.png',
  },
  新加坡: {
    pattern: '新加坡|坡|狮城|SG|Singapore|🇸🇬',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Singapore.png',
  },
  日本: {
    pattern: '日本|川日|东京|大阪|泉日|埼玉|沪日|深日|JP|Japan|🇯🇵',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Japan.png',
  },
  韩国: {
    pattern: 'KR|Korea|KOR|首尔|韩|韓|🇰🇷',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Korea.png',
  },
  美国: {
    pattern: '美国|美|US|United States|🇺🇸',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/United_States.png',
  },
  加拿大: {
    pattern: '加拿大|Canada|CA|🇨🇦',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Canada.png',
  },
  英国: {
    pattern: '英国|United Kingdom|UK|伦敦|London|🇬🇧',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/United_Kingdom.png',
  },
  澳大利亚: {
    pattern: '澳洲|澳大利亚|AU|Australia|🇦🇺',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Australia.png',
  },
  德国: {
    pattern: '德国|德|DE|Germany|🇩🇪',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Germany.png',
  },
  法国: {
    pattern: '法国|法|FR|France|🇫🇷',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/France.png',
  },
  俄罗斯: {
    pattern: '俄罗斯|俄|RU|Russia|🇷🇺',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Russia.png',
  },
  泰国: {
    pattern: '泰国|泰|TH|Thailand|🇹🇭',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Thailand.png',
  },
  印度: {
    pattern: '印度|IN|India|🇮🇳',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/India.png',
  },
  马来西亚: {
    pattern: '马来西亚|马来|MY|Malaysia|🇲🇾',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Malaysia.png',
  },
};

function hasLowCost(config) {
  const lowCostRegex = /0\.[0-5]|低倍率|省流|大流量|实验性/i;
  return (config.proxies || []).some((proxy) => lowCostRegex.test(proxy.name));
}

function parseCountries(config) {
  const proxies = config.proxies || [];
  const ispRegex = /家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地/i; // 需要排除的关键字

  // 用来累计各国节点数
  const countryCounts = Object.create(null);

  // 构建地区正则表达式：区分大小写（避免 node 里的 "de" 误匹配到 "DE" -> 德国）
  const compiledRegex = {};
  for (const [country, meta] of Object.entries(countriesMeta)) {
    // 兼容旧配置：如果 pattern 仍以 (?i) 开头，这里会剥离掉以避免 JS RegExp 报错
    compiledRegex[country] = new RegExp(meta.pattern.replace(/^\(\?i\)/, ''));
  }

  // 逐个节点进行匹配与统计
  for (const proxy of proxies) {
    const name = proxy.name || '';

    // 过滤掉不想统计的 ISP 节点
    if (ispRegex.test(name)) continue;

    // 找到第一个匹配到的地区就计数并终止本轮
    for (const [country, regex] of Object.entries(compiledRegex)) {
      if (regex.test(name)) {
        countryCounts[country] = (countryCounts[country] || 0) + 1;
        break; // 避免一个节点同时累计到多个地区
      }
    }
  }

  // 将结果对象转成数组形式
  const result = [];
  for (const [country, count] of Object.entries(countryCounts)) {
    result.push({ country, count });
  }

  return result; // [{ country: 'Japan', count: 12 }, ...]
}

function buildCountryProxyGroups({ countries, landing, loadBalance }) {
  const groups = [];
  const baseExcludeFilter = '0\\.[0-5]|低倍率|省流|大流量|实验性';
  const landingExcludeFilter =
    '(?i)家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地';
  const groupType = loadBalance ? 'load-balance' : 'url-test';

  for (const country of countries) {
    const meta = countriesMeta[country];
    if (!meta) continue;

    const groupConfig = {
      name: `${country}${NODE_SUFFIX}`,
      icon: meta.icon,
      'include-all': true,
      filter: meta.pattern,
      'exclude-filter': landing
        ? `${landingExcludeFilter}|${baseExcludeFilter}`
        : baseExcludeFilter,
      type: groupType,
    };

    if (!loadBalance) {
      Object.assign(groupConfig, {
        url: 'https://cp.cloudflare.com/generate_204',
        interval: 60,
        tolerance: 20,
        lazy: false,
      });
    }

    groups.push(groupConfig);
  }

  return groups;
}

function buildProxyGroups({
  landing,
  countries,
  countryProxyGroups,
  lowCost,
  defaultProxies,
  defaultProxiesDirect,
  defaultSelector,
  defaultFallback,
}) {
  // 查看是否有特定地区的节点
  const hasTW = countries.includes('台湾');
  const hasHK = countries.includes('香港');
  const hasUS = countries.includes('美国');

  // 排除落地节点、选择节点和故障转移以避免死循环
  const frontProxySelector = landing
    ? defaultSelector.filter(
        (name) =>
          name !== PROXY_GROUPS.LANDING && name !== PROXY_GROUPS.FALLBACK,
      )
    : [];

  return [
    {
      name: PROXY_GROUPS.SELECT,
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Proxy.png',
      type: 'select',
      proxies: defaultSelector,
    },
    {
      name: PROXY_GROUPS.MANUAL,
      icon: 'https://gcore.jsdelivr.net/gh/shindgewongxj/WHATSINStash@master/icon/select.png',
      'include-all': true,
      type: 'select',
    },
    landing
      ? {
          name: '前置代理',
          icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Area.png',
          type: 'select',
          'include-all': true,
          'exclude-filter':
            '(?i)家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地',
          proxies: frontProxySelector,
        }
      : null,
    landing
      ? {
          name: PROXY_GROUPS.LANDING,
          icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Airport.png',
          type: 'select',
          'include-all': true,
          filter: '(?i)家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地',
        }
      : null,
    {
      name: PROXY_GROUPS.FALLBACK,
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Bypass.png',
      type: 'fallback',
      url: 'https://cp.cloudflare.com/generate_204',
      proxies: defaultFallback,
      interval: 180,
      tolerance: 20,
      lazy: false,
    },
    {
      name: '🔒 私有网络',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Private.png',
      type: 'select',
      proxies: [PROXY_GROUPS.DIRECT],
    },
    {
      name: '🛑 广告域名',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/AdBlack.png',
      type: 'select',
      proxies: ['REJECT', 'REJECT-DROP', PROXY_GROUPS.DIRECT],
    },
    {
      name: '📋 Trackerslist',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/AdBlack.png',
      type: 'select',
      proxies: ['REJECT', 'REJECT-DROP', PROXY_GROUPS.DIRECT],
    },
    {
      name: '⬇️ 直连软件',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Terminal.png',
      type: 'select',
      proxies: [PROXY_GROUPS.DIRECT],
    },
    {
      name: '🪟 微软服务',
      icon: 'https://gcore.jsdelivr.net/gh/hazicy/override-rules@master/icons/Microsoft_Copilot.png',
      type: 'select',
      proxies: defaultProxiesDirect,
    },
    {
      name: '🍎 苹果服务',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Apple.png',
      type: 'select',
      proxies: defaultProxiesDirect,
    },
    {
      name: '🇬 谷歌服务',
      icon: 'https://gcore.jsdelivr.net/gh/hazicy/override-rules@master/icons/Google.png',
      type: 'select',
      proxies: defaultProxiesDirect,
    },
    {
      name: '🎮 游戏服务',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Game.png',
      type: 'select',
      proxies: defaultProxiesDirect,
    },
    {
      name: '🎥 奈飞视频',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Netflix.png',
      type: 'select',
      proxies: defaultProxies,
    },
    {
      name: '📽️ 迪士尼+',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Disney.png',
      type: 'select',
      proxies: defaultProxies,
    },
    {
      name: '🎞️ Max',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/HBO.png',
      type: 'select',
      proxies: defaultProxies,
    },
    {
      name: '🎬 Prime Video',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Prime.png',
      type: 'select',
      proxies: defaultProxies,
    },
    {
      name: '🍎 Apple TV+',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Apple.png',
      type: 'select',
      proxies: defaultProxies,
    },
    {
      name: '📹 油管视频',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/YouTube.png',
      type: 'select',
      proxies: defaultProxies,
    },
    {
      name: '🎵 TikTok',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/TikTok.png',
      type: 'select',
      proxies: defaultProxies,
    },
    {
      name: '📺 哔哩哔哩',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/bilibili.png',
      type: 'select',
      proxies:
        hasTW && hasHK
          ? [PROXY_GROUPS.DIRECT, '台湾节点', '香港节点']
          : defaultProxiesDirect,
    },
    {
      name: '🎶 Spotify',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Spotify.png',
      type: 'select',
      proxies: defaultProxies,
    },
    {
      name: '🌍 国外媒体',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/GlobalMedia.png',
      type: 'select',
      proxies: defaultProxies,
    },
    {
      name: '🎮 游戏平台',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Game.png',
      type: 'select',
      proxies: defaultProxies,
    },
    {
      name: '🤖 AI 平台',
      icon: 'https://gcore.jsdelivr.net/gh/hazicy/override-rules@master/icons/ChatGPT.png',
      type: 'select',
      proxies: defaultProxies,
    },
    {
      name: '📈 网络测试',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Speedtest.png',
      type: 'select',
      proxies: defaultProxies,
    },
    {
      name: '🧱 代理顶级域名',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Proxy.png',
      type: 'select',
      proxies: defaultProxies,
    },
    {
      name: '🧱 代理域名',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Proxy.png',
      type: 'select',
      proxies: defaultProxies,
    },
    {
      name: '🛡️ 直连域名',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Direct.png',
      type: 'select',
      proxies: [PROXY_GROUPS.DIRECT],
    },
    {
      name: '🀄️ 直连 IP',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Direct.png',
      type: 'select',
      proxies: [PROXY_GROUPS.DIRECT],
    },
    {
      name: '📲 电报消息',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Telegram.png',
      type: 'select',
      proxies: defaultProxies,
    },
    {
      name: PROXY_GROUPS.DIRECT,
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Direct.png',
      type: 'select',
      proxies: ['DIRECT', PROXY_GROUPS.SELECT],
    },
    {
      name: '🐟 漏网之鱼',
      icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Final.png',
      type: 'select',
      proxies: defaultProxies,
    },
    lowCost
      ? {
          name: PROXY_GROUPS.LOW_COST,
          icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Lab.png',
          type: 'url-test',
          url: 'https://cp.cloudflare.com/generate_204',
          'include-all': true,
          filter: '(?i)0\\.[0-5]|低倍率|省流|大流量|实验性',
        }
      : null,
    ...countryProxyGroups,
  ].filter(Boolean); // 过滤掉 null 值
}

function main(config) {
  const resultConfig = { proxies: config.proxies };
  // 解析地区与低倍率信息
  const countryInfo = parseCountries(resultConfig); // [{ country, count }]
  const lowCost = hasLowCost(resultConfig);
  const countryGroupNames = getCountryGroupNames(countryInfo, countryThreshold);
  const countries = stripNodeSuffix(countryGroupNames);

  // 构建基础数组
  const {
    defaultProxies,
    defaultProxiesDirect,
    defaultSelector,
    defaultFallback,
  } = buildBaseLists({ landing, lowCost, countryGroupNames });

  // 为地区构建对应的 url-test / load-balance 组
  const countryProxyGroups = buildCountryProxyGroups({
    countries,
    landing,
    loadBalance,
  });

  // 生成代理组
  const proxyGroups = buildProxyGroups({
    landing,
    countries,
    countryProxyGroups,
    lowCost,
    defaultProxies,
    defaultProxiesDirect,
    defaultSelector,
    defaultFallback,
  });

  // 完整书写 Global 代理组以确保兼容性
  const globalProxies = proxyGroups.map((item) => item.name);
  proxyGroups.push({
    name: 'GLOBAL',
    icon: 'https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Global.png',
    'include-all': true,
    type: 'select',
    proxies: globalProxies,
  });

  const finalRules = buildRules({ quicEnabled });

  if (fullConfig)
    Object.assign(resultConfig, {
      'mixed-port': 7890,
      'redir-port': 7892,
      'tproxy-port': 7893,
      'routing-mark': 7894,
      'allow-lan': true,
      ipv6: ipv6Enabled,
      mode: 'rule',
      'unified-delay': true,
      'tcp-concurrent': true,
      'find-process-mode': 'off',
      'log-level': 'info',
      'geodata-loader': 'standard',
      'external-controller': ':9999',
      'disable-keep-alive': !keepAliveEnabled,
      profile: {
        'store-selected': true,
      },
    });

  Object.assign(resultConfig, {
    'proxy-groups': proxyGroups,
    'rule-providers': ruleProviders,
    rules: finalRules,
    sniffer: snifferConfig,
    dns: fakeIPEnabled ? dnsConfigFakeIp : dnsConfig,
    'geodata-mode': true,
    'geox-url': geoxURL,
  });

  return resultConfig;
}
