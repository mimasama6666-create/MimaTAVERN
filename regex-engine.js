/**
 * 🧬 MimaTAVERN Regex Engine
 * Additive sidecar: safe JavaScript RegExp replacement only. No eval / no executable code.
 */
(() => {
  'use strict';

  const PHASES = new Set(['display','prompt','input','output']);
  const FLAG_ORDER = ['d','g','i','m','s','u','v','y'];
  const nowIso = () => new Date().toISOString();
  const makeId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
  const arr = v => Array.isArray(v) ? v : [];
  const text = v => String(v ?? '');

  function normalizeFlags(value='g') {
    const raw = String(value || 'g').toLowerCase();
    const unique = [...new Set(raw.split('').filter(ch => FLAG_ORDER.includes(ch)))];
    return FLAG_ORDER.filter(ch => unique.includes(ch)).join('') || 'g';
  }

  function normalizeRule(rule={}) {
    return {
      id: rule.id || makeId('regexrule'),
      name: String(rule.name || '未命名规则').trim() || '未命名规则',
      pattern: text(rule.pattern),
      replacement: text(rule.replacement),
      flags: normalizeFlags(rule.flags),
      phase: PHASES.has(rule.phase) ? rule.phase : 'display',
      priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 50,
      enabled: rule.enabled !== false,
      description: String(rule.description || '').trim()
    };
  }

  function stableRuleId(pack,rule){
    const seed=String(pack.id||pack.name||'')+'|'+String(rule.pattern||'')+'|'+String(rule.replacement||'');
    let hash=2166136261;for(const ch of seed){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);}
    return (hash>>>0).toString(16);
  }
  // Content signatures identify the original transitional decoder, never a
  // local storage ID or an ordinary user rule that happens to share its ID.
  const legacyProtocolDecoders={"campus_semantic_r7_20261125":["8d662b15788aa0204f92ea0986c2840b42e832cd9b1c7a6098033c2cd6b6fff3","e5cffb1d4122283c77e73229c43b3e481068340110ba31aae7341ea5e2dafe53","431532b72d4b57d893ef41a30bc86d469fa34c0538564afdbba6339ad290fb1f","c3bb85444e82b8467c859fc65a7d0e32c0c1f90a4ffa0bf3ceb99b5a12960596","b50c1945e1f219216a9e97dc85da3148b25446d2ee3beeaf4a3ea084610bf137","ccfd0c18064be6104ad84b414e439bdc4af3fd2210092dd2f79b0b3f79a9d471","89ef1c803dae5f7ddb5002f49a4bba04cffa48b31dcb8a1f78eeaa579784e8c5","c9a6231a968c451006ea47a16d510da8b21dfee74a28d6c2c13effb028586a40","699554cdf412b9111b9bcf217342e63baa28c90bc966135424c1fdca491bfee3","e7ad94e6f1afed3db2d6f1516d7c228790bdd9fe0f7901d716d66df401302d0b","1f17e0a00ed55ef16f006b850c47caf4046c7f45569fd01306f77853520844c2","6c9dac25de1c0b29869984a7ef95195dbf1825711233f789a6c87cef44070bee","a94a3a60960ff26583185729a57b473af43cf7265b0ac039b2e6ba1ab9d7deba","cad47419e51838cda759565a0d98e89b48f8690db1e2db7861707ee8337741a8","ac0f9fc9e162f38d3863fd32f7df35a0f8774e28922b638806fd88b777428f5b","31e583357f1d0546f8caed98f92b7c2f5d1f3179ec339ff0e1adde18d588da1b","84fd58d1945d6bb4c53427a2a85981c272d4bc9b2ac3fc373c7dfc54f28967c6","b68d5a0ebea6138a45c564d300078a2b02aa24ed3567adf378e4e372fc65d483","c7b0c9c5b7427877a66adf8686ae39b4e1da6648dd65c63caa8750c312f83261","6506a76b806a868cb2099588147220632655aa915fcaf66def58403bebcfbd43","8e7605ce74dccce716784c9c3723dcebc4cbf62adb3e48c67ce76c07b84564ba","5cc5b43d35ceb13021be29c44fb1ed31833dafdba7c256bc8ae9610bf074f8f3","e3c255398bf6bc62bab9ba78491f89a432fb192fe469af722b49d1cd7a905d51","6316dc5db911c77e9283e33b0b701289ec1456d3493b565de08fb55913c84364","a5e4b1213fa367405a65118336fb08e488d512c0dd7b51a0c0e884fe96ea95d2","cd9e403e67e9c57cfb0a0e54ef41ac38987e7f0e541a8e1fba51e51268285bc9","744665c7d4382a3fe8aaa66fff0a16e349eb7be6b7bc4cc27f148b610a0706d7","8c5358f2fa1a89b5532e86d3f838cf88a369db8878360dfa153c636dce9e98a9","9a0669be8d15aa8f65dd8c3c9af8963f9a420ee0a503b4d80e996915cb051901","d039d8e1783e32a39ad1ac181749b4b4cbf447d6ac20f38f1180a6a08ed14de8","7703b05b57f536ce83f256b32170fe7e41240020408a93f959662e350fdf2244","1921a06f293e2f05969f3518634a9585e4ec1d467bd7f9e4f1d72c6bafbab437","ca17a5c3623785098d7fa2f7f217de7a5a805a07314241497641af25c8101820","ee3c0287be8cf2ab6f9d1d86ff4511ea60179480272fc41a87c686e812c76d17","3050e27c3b1df93593898371d5d30ea9967b1b45a4815819c731e1e6b89984c0","469e6932c0f1425be866f0f3a199c3352e7cb981939850830ca601455faceb5d","942d3ab67fea3e57ede183d66f8271febd0ea5156a19bac27c37f165a7da05d1","390091b97aa02d9f9b7a80fe3913f16916f66192810a108d01f3bd4c76a14dc5","4eeb0899fd53c385050d2a3601bdbbe223f925dae10f18c6041eced5b3c78380","2c8046911e538b3c1b0af116549d9453769cd81bf4d81f15947760ad20d45cb1","a31a130cd520964150ba3fc646b897e59d582fdd5af112d9bdcb468b6819e2b5","0736ed459db234da9b8d5286e6f625eb3fad0f4e0245b2926800b3e521fd1679","1f65d7e25d22180e2d6b48f454b1a457f285da6c3e823929918f07eacbc0015a","f1437d2f14fc5fedc0cd6f0f86d244749580e7ba92c5af56e6465495746f66b0","7205bd63618359159150e9ce2b67d346ddc2ea4ed9d495a0ea6eb07d926f1aef","29d948b6d4f40f26b3b802263731f6b0ebcc488a6c466281671c845db4137660","e29b1176e596d615f1ffc4467920f78337a725d5646478621092cc81de82b3cc","e258db8fdd597aae230ee367b5a5cad2cfd8e3e60ef1b6000cee039fa85bb355","81ada555234acb77751d3636b3a56533626727fef226ac04f73603b32daff148","f076a63c65c0fc3d860945ec09f8dab5eee4e3a99d057190b04d097d0708ff28","f51a3952d8e75c2bfed1c95d0f8d3bf9eccf6df0a736f5c9f3f4e3da7e95d65f","1526e44e37cbbe8687e32b7478376602a3271d7449989025728a55752f147c44","224c01b8c6ee165ddf47d9bd7225cb9dc11c758c3fbd23c7a27feb8ccd11afad","e885667c78356ec61bba6bf11c51212d81f8f0a6b109169d058b886245706569","988af76ff020809e0b4bd767d09c770fb775501f4c3c12f342c83ed5a0da716e","c4bd111944f39d9d51abe6d1231d6e590ed8690d4f8d2744ac702d2cb47eb490","00fd2dc23bd436d833f7d397ffe6c49c05d82cb17640de3db6a18ab3eddf3e93","5606b4622750ffc4f32c420c2dc37e62eed4d20965dec2de52c98a4e411401b1","5598bac243082972d26e0c7d810f503b2c72d4aa58fb0f3e8a6fda4eb2df035a","59c73acaa20ddd799a9cf84a041b1520ab65ab808b5de1e15f686e036e7b5f01","7dd095f6ff120b1481fe245c36ef495fdb973f34ee2aaeef9ff06bde3dfa61f4","535aff5d5af9442b79a0e0d24ebf86c6e4dd2e5744234f30fdf4b90ea12603ab","78216b10014735019266e09bac7b48db3bc258f96816e72639d4e04ca0a090e9","6797da2aa4851d80016372e7531bae768b76d9233da9d7a0228c94e0a32feb13","a3338f3b14e7aa13d6d5d711be7fcb7a6e7b12d0aeddd92098dcc601dce738c1","91d4144aebb7d186f65a8d07ba32fc00dcaeb1ef33b60ba681d1af4223783644","009ff6fae8ebfbc56f9c476bdf34234200e8840a307767934171fbfe26cd402e","93fe68a8bbc611dcbfefcf7e156cc5a011c6ea10fa81f501fdc364fe9eab6de6","8ddac7169d6c047c83bd7bca36f7e13347a098b690ea310967e46954239ecbc0","67b4e6fef56ddf8dd75f4c89d8e4ade15221415089ee787291898066dca63293","c2478d0ec8b0e677bd1ed579c594d81ad6f22539206f9b3d767070abca7dc9f7","c47ad6de019b9fe095bd8b9f6239c8578702b3ae8574fd5b407749c288653370","c85051101433538c76e1ba3f8a524daa86c8dd6d00ad492a092b9d29050ad75a","eac9b5f682c75cc2dceced2fcc17c63d37ffcbb739fc9155fd05ff236e045ba9","6bdf991d7a164da1aa6a8030d01648a0eab6408d40336df4ea11e31f73ec40c0","c35d8315f0227c46d8b6087e88cf297eb7273aa1a26abce86addac75dfad7aa2","7edb7a8d7eb00175eafb66e61b884e84311db587107bbc22ef968ecb3d197c9e","5ea7ddd519bfcd5632a1646afaa381df1f4f3c7d98d5ba3a3ab1d63852f05566","1bc4394440c04f53e99d57a0990420cbe4d17644d300b960366255d4e51bebd2","7b8105c3d4984b8e6f9bc5fe70262e561113471860ac6d2ab098f51bcee05623","532fe7ef3622bf83d4fa5e81e99f3b4f5be3745c5e98e476bcec22ff9d11e651","93f8263ccaa79cdefa96264cc06a3e376ac6ecdd361cce549540077ea5ebd615","a1715c728baaaa7bf23b1d2b48ede52a27fb2cfb7047ca948a588b76d18dfa98","8925b44f5c73f260555fb3aea3a7476ac2252b60385412c60babb2e39ddf786b","5e7c9a07bea4481071b1f01da0eeb1769b86d6297326e1162e667b178f3dbe5a","6d7b30e3fc9c7e8d29544e5d57833c93cd7a34b82b1123e00a32ff0a792355b7","2e60572fa14f188628007f1f4137a380a9dc95ac32b31f15d735aaec366450df","4f91c55821cca5becf69c275e0e2f0049a99ef39c2ebea50196d9b682576d6ba","6b64009d9d605d7e1fb2568865c58120b78017ac0a74798c1a9af5c172b4ef07","ce888e9d07f4a0bc822a3239aa39170f01cc88c6facb76995689765d7c3c8719","f80d9043d28fdde68853ae1fc8139855cc5ce70af3d4ea2d7e7286f0fc6496cd","342da4150e6b9a6741900216b0b1b7ab462daea8d6691c9caca853f3245db528","781d42f1eb6327b560387db8ea1b3e63c4e6f54defe18170dcc55a13ac8135d9","c9baa663a16bc40fca9e640f6e417af920dc6d772ec310286a0208e59791c2a6","6c89a484a75385e7c547331df73b7835bad4683d83bdf175363032835933ce6d","88725233f470ac424886481645ae347388edada69adb9792f48fbe990336131c","14def892c10f050f936e5852c67f381069919441978fdec1e2e60f3d1b021588","3d2a0f685591e5871fa2473508d71b4f6d7da3521ddccc795ef5d279f62092d4","1d96635df5717baacc88fa57c0c31027e1acbde91ccc7c44ea930d2e97d9599a","b4de54bf8a83667197b5e6939b0def8d7312794434e2bf40a3a89467d4669421","2032ac8db68c1bb2c4a03db433b4a6605414ad0788aaabe5f474f0b913c702a0","016a7de34cb7eb485aa7d7799ee02c65ba90d9e41ee8b89f1e6389d03c08240c","4a7730271fda5c4b0e879bffcae5b3d5bfaf1033cef3866ccdd5382bac468ef7","52088083952e9450c1b53c2ac823ae2f3aa3cbfd51d63f22e79dd1118abf700b","80e2ba6a2c5d661ec459ea8deeab18a6a1c5b9b8a2d0cd9353acd79673f19e00","952cd85da64a26ddcf29a58e5508958d08144fbcff9a56e7d11e430ac76e3f35","145d505d3493c35fbc86b644fe927c42c15264968fa6d94eea12774b5a6b79f9","182da1bfa4b66524ed6ac272d61d8f447f59abf4905310034fd783998fc03e67","f5cbc91dffc3a84dd650a0e6d2d7b076680ed9c1ba32bb9a612f1f8ec1524d40","b3e92c69c5f64a712822e6bfcfdf9ba03fadb98b7e09e79fb924db79f80e58db","d27cd2bbbd326710d0539f50e90645670fc98b5760af224dec6d71ff47ad2487","dd13f6f348300aef28b23f4d0fb4feb0ccb1822d162bd0b7b1676a9bce2a3cce","738264a022d031fdefd6b3f5d9876434fbaecdd58479788428442a10163b3794","8e0003d15f405ee4176bdc5a175be81bc437191bdc616e6d61b138a3670d3889","65007adf66ecbee4bf51d7ed9f4055bcac058dd427d452d41c07f6e57a11da80","5bb67cce2838a2e4e64de95dd93e9d2a60b3ea57a5bc062e5b25a49cfe609a4e","ea91ff3d9c45807d5015877b26d4cc147085d812ae156e3cbfe70ea5685e2189","dc3cfa5673aadd15d1ff3eb551900e87e5fb83c8d64e5645654822c32f1e8d06","14717b70f416ec3211b88828a6b6063221c2dd621bf4d4f6a96c0feb5ffc01ce","547bcf71235a6966d09316297954f9b5987bdc6438de1f92a4849dd467ed1ad1","05a4494ba6307e7d42a8f373043ed35c816bdd453477984744a22efb927489c3","26b5115f5f0bd925bf2cca5c3fd0d056e7b24768e5c2b48a04bcc7e1d490d9cb","2bc3f4e4b06a13ee822b08e2a7e8e30c4ca9412e5e199512d64f86d18092c2b8","cfde321506267175792ad22557a36750ae88510fa5808016b49d0a6bdabceef5","e8eb35906836e1ce782c649836d260317aa8c408a10181fd9d99d2cc31a197c4","1d27b08e518514c1019c975a50414854cc9af39a5259cc31ec82ecbcbd3a8909","fc4b50a5915e6963a360f9831731b0c8eb16426278a3f43a2005e542d3846141","0b52d1ef5635c80298687b5ad0732d451210d0c295b08b62c3b5e6f8d4b32b9d","dfc834d49303b8c40679c29c04c776df7cdb0d4443820cc0fa84b87f6802d1e0","a02756b1cbadbcd878b5521893cf2710ff1b5bbee6f85610fbb697b1440e6041","0465656acf5551e2f6bbbee6ff6e18d5d8317496f6cd199ec6a106ef493cc7f5","9063155d4b8b098c27d1020d7f584ec9ef31ae65dacc419989da83e031d8e2fd","c74bebcfe770dd763477a22a52ff068de2b50d78e0331c95236e721261fb06df","966cb82a404365c8edea9aad56bfe56663f8f8089cda2c2111a71f0c71d748e7","4e077861991fd17cca9f19b78a3e3dff59596628e371f1e6a6196fe09e9e9626","75f87881f1f1166400a4448db68230368d67ef90d96ae471385616e5cf44a1fc","630a62a17d710358e6ec3d7bc2cb674aa23abfa0c7d251a91df7a61049c77b46","e8f097e1ff88f526306c7af441e39b30f985726a7f960621c2ec88c13e3a1be7","259a664392dd706a68f0e77a3a007d291f2ffb01d253aeab657eadcd1c6749b6","fa5418d6312afd94c02ac352886cfa96d21cdd65a9b06569166f6fa92b9a3b24","971555ca097efb14a56f4fa1501c8aac6391a503895624dceb0b458d3b57434f","84aac4580a72ecbed7601158ca48c47cb23c21e99e8a59932e6bee7e3002e1c9","1ff9753a10ce80699f6ffc089cbab4a7c7f96d69e893b8715d9640a3730b7405","4958b027fcb9be87639bf5aef5c8bc744e3d6365d3d7bcae2913ec986d03c0ee","cacc3648f7163e4bcd648ac0628041f4eaadb1b7c7565ab124ff4bfbde14206a","649c18ccd46449cfe5ccfe582cbfe6978c293104799afdbef32c70ee3a59a1ef","0a324e4cf37f2f132c3a83b19842923c0fc4bb880011498f88b85c7dc4a1e800","b157e9a9f7b119d6f29bbb7f0575965b43b8b3c7057e15e40a7ecfdccd0bc79f","4723b0c9e4131cac88078c4602b2838f02403661958679ec484235f91c8ed7e0","f1e3696b7369466a20e3f1de5059ca50a853bdf667ba0d4610c671b0197c1ea3","9f98f61b446ac1450a13192a85b39185644fa59093cf6616925c3641b37f061f","4c65f5244c8bbd9656c1f31ab5710a6c93b37ee0e5e0e351770d153934502df1","804186687be208089957d09f7ddd7c90ca97eb47f8afb168ec5560b07bded3a3","0d06da6ef0f93e9cdaab669f90d0cdd7ffbea24559ad1bc6c264a6c4d213c6bd","f3e9d965a8ba15abfea1d712ccb831bfffd8673e7305b8360e455b0f71d5a431","4597a412434ce5c3512fd84605fe6c5291e5748276819899d4c12621c1319335","dd40b909dde09cac785f51fc23bba3b28143b02b67390c136b217d1b70446f90","a6d3c10cfacfb996146ca0d3d328bb6c14b3be7f13191177ac30de2cb98b988e","24d2074ca8c2627496beff86be96b304822f0c391926863613ef25482afccdbe","c8f926395446cd3bd44ff33ca860a2b7692caef8da5cf92c7b1b8430811b3b75","f92bfa0ed5eefea19c8ac6064dc1902c4cd92a138de0126e8ae030d6c6776474","651b659186c4bf2d1d39e83397f396b9de55bbf18d62b2ddfe391dcd9d07be6f","f823f02dcb8510b9b91fa44ab962f0aea2d95e63a4bde4aabdd4dbbe51d6181f"]};
  const ruleIdentityCache=new WeakMap();
  function decoderRuleIdentity(rule){
    if(ruleIdentityCache.has(rule))return ruleIdentityCache.get(rule);
    const value=JSON.stringify([rule.phase||'display',normalizeFlags(rule.flags),String(rule.pattern||''),String(rule.replacement??'')]);
    const id=window.MimaSHA256.create().update(new TextEncoder().encode(value)).hex();ruleIdentityCache.set(rule,id);return id;
  }
  function protocolDisplayPacks(packs,resource){
    const declarations=new Map(arr(resource.compatibilityDecoders).map(row=>[row.identity,new Set(arr(row.ruleDigests))]));
    for(const identity of arr(resource.compatibilityPackIds))if(!declarations.has(identity)&&legacyProtocolDecoders[identity])declarations.set(identity,new Set(legacyProtocolDecoders[identity]));
    return packs.map(pack=>{
      const digests=declarations.get(pack.protocolIdentity||pack.id);if(!digests)return pack;
      if(pack.protocolRole!=='compatibility-decoder'){const present=new Set(arr(pack.rules).map(decoderRuleIdentity));if(![...digests].every(digest=>present.has(digest)))return pack;}
      const rules=arr(pack.rules).filter(rule=>(rule.phase||'display')!=='display'||!digests.has(decoderRuleIdentity(rule)));
      return rules.length===arr(pack.rules).length?pack:{...pack,rules};
    });
  }
  function stableProtocolIdentity(pack){
    if(pack.protocolIdentity)return String(pack.protocolIdentity);
    // R6 imports already on disk have lost their external ID. Recover identity
    // only when every original decoder rule is present; unrelated rules stay.
    for(const [identity,known]of Object.entries(legacyProtocolDecoders))if(arr(pack.rules).length>=known.length){
      const signatures=new Set(arr(pack.rules).map(decoderRuleIdentity));
      if(known.every(digest=>signatures.has(digest)))return identity;
    }
    return String(pack.id||'');
  }
  function normalizePack(pack={}) {
    const createdAt = pack.createdAt || pack.updatedAt || (pack.id ? '' : nowIso());
    const protocolIdentity=stableProtocolIdentity(pack),known=legacyProtocolDecoders[protocolIdentity];
    const signatures=known&&arr(pack.rules).length>=known.length?new Set(arr(pack.rules).map(decoderRuleIdentity)):null;
    const protocolRole=pack.protocolRole==='compatibility-decoder'||known&&signatures&&known.every(digest=>signatures.has(digest))?'compatibility-decoder':null;
    return {
      id: pack.id || makeId('regexp'),
      protocolIdentity,
      ...(protocolRole?{protocolRole}:{}),
      name: String(pack.name || '未命名正则包').trim() || '未命名正则包',
      description: String(pack.description || '').trim(),
      priority: Number.isFinite(Number(pack.priority)) ? Number(pack.priority) : 50,
      enabled: pack.enabled !== false,
      rules: arr(pack.rules).map((rule,index)=>normalizeRule({...rule,id:rule.id || `legacy_rule_${index}_${stableRuleId(pack,rule)}`})),
      displayStyles:arr(pack.displayStyles).slice(),
      ...(pack.compactContract!=null?{compactContract:pack.compactContract}:{}),
      ...(pack.protocolResource!=null?{protocolResource:pack.protocolResource}:{}),
      createdAt,
      updatedAt: pack.updatedAt || createdAt
    };
  }

  function compileRule(rule) {
    const r = normalizeRule(rule);
    if (!r.pattern) return { ok:false, rule:r, error:'pattern 为空' };
    try { return { ok:true, rule:r, regex:new RegExp(r.pattern,r.flags) }; }
    catch (e) { return { ok:false, rule:r, error:e?.message || String(e) }; }
  }

  function validatePack(pack) {
    const normalized = normalizePack(pack);
    const invalid = [];
    normalized.rules.forEach((rule,index) => {
      const result = compileRule(rule);
      if (!result.ok) invalid.push({ index, id:rule.id, name:rule.name, error:result.error });
    });
    return { ok:invalid.length===0, pack:normalized, invalid };
  }

  function applicable(packs,phase){return arr(packs).some(p=>p&&p.enabled!==false&&arr(p.rules).some(r=>r&&r.enabled!==false&&(r.phase||'display')===phase));}
  // Synchronous evaluation is forbidden for user-supplied expressions: a
  // RegExp has no built-in deadline and can freeze the UI before a timer fires.
  function apply(input,packs=[],phase='display',diagnostics=null) {
    if(applicable(packs,phase)){
      const e=new Error('原生正则需要隔离执行；请使用 applyAsync（原文未修改）');e.code='E_REGEX_ASYNC_REQUIRED';throw e;
    }
    return text(input);
  }
  // Compare immutable execution fields once per resource read. No display
  // stylesheet, descriptions, disabled rules or unused phases cross to Worker.
  const projected=new WeakMap(),previousByPack=new Map();
  let executionRevision=0;
  function executionPack(pack,phase) {
    let phases=projected.get(pack);
    if(!phases){phases=new Map();projected.set(pack,phases);}
    if(phases.has(phase))return phases.get(phase);
    const rules=arr(pack.rules).filter(rule=>rule?.enabled!==false&&(rule.phase||'display')===phase)
      .map(({id,name,priority,pattern,replacement,flags})=>({id,name,priority,pattern:text(pattern),replacement:text(replacement),flags:normalizeFlags(flags)}))
      .sort((a,b)=>Number(a.priority??50)-Number(b.priority??50));
    const key=JSON.stringify([pack.id,phase]);
    const previous=previousByPack.get(key);
    const same=previous&&previous.name===pack.name&&previous.priority===pack.priority&&previous.rules.length===rules.length&&
      previous.rules.every((rule,i)=>Object.keys(rule).every(k=>rule[k]===rules[i][k]));
    const row=same?previous:{id:pack.id,name:pack.name,priority:pack.priority,rules,revision:++executionRevision};
    previousByPack.delete(key);previousByPack.set(key,row);
    while(previousByPack.size>256)previousByPack.delete(previousByPack.keys().next().value);
    phases.set(phase,row);
    return row;
  }
  function executionPlan(packs,phase){
    const projected=packs.filter(pack=>pack&&pack.enabled!==false)
      .map(pack=>executionPack(pack,phase)).filter(pack=>pack.rules.length)
      .sort((a,b)=>Number(a.priority??50)-Number(b.priority??50));
    return {key:phase+':'+projected.map(pack=>pack.revision).join(','),packs:projected};
  }
  const idleWorkers=[];
  const regexError=(code,message,details={})=>Object.assign(new Error(message),{code,...details});
  function acquireWorker(){
    if(typeof Worker!=='function')throw regexError('E_REGEX_ISOLATION_UNAVAILABLE','此环境没有可终止的正则 Worker，原文保留');
    if(window.location?.protocol==='file:')throw regexError('E_REGEX_WORKER_ORIGIN','请通过 HTTP/HTTPS 打开咪嘛馆，以加载隔离正则线程');
    return idleWorkers.pop()||{worker:new Worker(new URL('./regex-native-worker.js?v=20261125-v23-r3',document.baseURI),{name:'mima-native-regex'}),configurations:new Set(),sequence:0};
  }
  function releaseWorker(lease,healthy){
    if(!lease)return;
    lease.worker.onmessage=null;lease.worker.onerror=null;
    if(healthy&&idleWorkers.length<2)idleWorkers.push(lease);else lease.worker.terminate();
  }
  function workerCall(lease,packet,options){
    const budgetMs=Math.max(100,Math.min(8000,Number(options.budgetMs)||5000));
    return new Promise((resolve,reject)=>{
      let done=false;const id=++lease.sequence;let timer;
      const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);lease.worker.onmessage=null;lease.worker.onerror=null;error?reject(error):resolve(value);};
      const abort=()=>finish(regexError('E_REGEX_ABORTED','正则操作已取消；原文保留'));
      lease.worker.onmessage=event=>{const r=event.data;if(r?.id!==id)return;if(!r.ok)return finish(regexError('E_REGEX_WORKER_FAILED',r.error||'正则线程执行失败'));
        if(packet.type==='configure')return finish(null,r);
        if(typeof r.output!=='string'||!Array.isArray(r.diagnostics))return finish(regexError('E_REGEX_BATCH_MALFORMED','正则线程返回不完整'));
        if(r.diagnostics.length){const e=regexError('E_REGEX_RULE_FAILED',r.diagnostics.map(d=>`${d.packName||'正则包'} / ${d.ruleName||'规则'}：${d.error}`).join('；'),{diagnostics:r.diagnostics});return finish(e);}
        finish(null,{output:r.output,diagnostics:r.diagnostics,matchedPack:r.matchedPack,missingFields:r.missingFields||[]});};
      lease.worker.onerror=event=>finish(regexError('E_REGEX_WORKER_FAILED','正则线程异常：'+(event.message||'未知错误')));
      timer=setTimeout(()=>finish(regexError('E_REGEX_BUDGET',`此条消息的正则执行超过 ${budgetMs} 毫秒；已停止该任务，原文完整保留`)),budgetMs);
      if(options.signal?.aborted){abort();return;}options.signal?.addEventListener('abort',abort,{once:true});
      try{lease.worker.postMessage({...packet,id});}catch(e){finish(regexError('E_REGEX_WORKER_FAILED','正则线程无法接收资料：'+e.message));}
    });
  }
  async function applyBatchAsync(entries,packs=[],options={}){
    const list=arr(entries).map(e=>({input:text(e.input),phase:e.phase||'display'}));
    if(!list.length)return [];
    const plans=new Map([...new Set(list.map(e=>e.phase))].map(p=>[p,executionPlan(packs,p)]));
    const results=new Array(list.length);
    let cursor=0;
    async function runLane(){
      let lease=null;
      try{
        while(cursor<list.length){
          if(options.signal?.aborted)throw regexError('E_REGEX_ABORTED','正则操作已取消；原文保留');
          const index=cursor++,item=list[index],plan=plans.get(item.phase);
          let result;
          try{
            if(!plan.packs.length&&!options.protocol?.length)result={output:item.input,diagnostics:[],matchedPack:false,missingFields:[]};
            else {
              lease||=acquireWorker();
              if(!lease.configurations.has(plan.key)){
                const receipt=await workerCall(lease,{type:'configure',key:plan.key,packs:plan.packs},options);
                lease.configurations=new Set(receipt.keys);
              }
              result=await workerCall(lease,{type:'run',key:plan.key,input:item.input,
                tracePackId:options.tracePackId,protocol:options.protocol},options);
            }
          }catch(error){
            releaseWorker(lease,false);lease=null;
            if(error.code==='E_REGEX_ABORTED'||options.settleIndividually!==true)throw error;
            result={error:{code:error.code||'E_REGEX_WORKER_FAILED',message:error.message,diagnostics:error.diagnostics||[]}};
          }
          results[index]=result;
          if(options.settleIndividually===true)options.onSettled?.(index,result);
        }
      }finally{releaseWorker(lease,true);}
    }
    const parallel=options.settleIndividually===true&&list.length>1;
    if(parallel)await Promise.all([runLane(),runLane()]);
    else await runLane();
    return results;
  }
  function disposeWorkers(){while(idleWorkers.length)idleWorkers.pop().worker.terminate();}
  window.addEventListener?.('pagehide',disposeWorkers);
  async function applyAsync(input,packs=[],phase='display',diagnostics=null,options={}){
    const [result]=await applyBatchAsync([{input,phase}],packs,options);
    if(Array.isArray(diagnostics))diagnostics.push(...result.diagnostics);
    return result.output;
  }
  window.MimaRegexEngine = { PHASES:[...PHASES], normalizeFlags, normalizeRule, normalizePack, protocolDisplayPacks, compileRule, validatePack, apply, applyAsync, applyBatchAsync, executionKey:(packs,phase='display')=>executionPlan(packs,phase).key };
})();
