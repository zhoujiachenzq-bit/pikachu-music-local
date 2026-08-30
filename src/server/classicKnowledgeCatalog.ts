import type { KnowledgeDocumentInput } from './agentKnowledge.js';

interface ArtistCatalog {
  artist: string;
  tracks: readonly string[];
  profile: string;
  genres: readonly string[];
  moods: readonly string[];
  scenes: readonly string[];
}

const zhCatalog: readonly ArtistCatalog[] = [
  { artist: '周杰伦', tracks: ['晴天','稻香','夜曲','七里香','青花瓷'], profile: '旋律叙事、R&B 与东方意象兼具，适合从青春回忆过渡到安静沉浸。', genres: ['华语流行','R&B'], moods: ['怀旧','温暖'], scenes: ['夜晚','散步'] },
  { artist: '林俊杰', tracks: ['江南','她说','修炼爱情','可惜没如果','小酒窝'], profile: '细腻抒情与强旋律并重，情绪从温柔陪伴延伸到遗憾释放。', genres: ['华语流行','抒情'], moods: ['温柔','深情'], scenes: ['独处','通勤'] },
  { artist: '陈奕迅', tracks: ['十年','好久不见','红玫瑰','富士山下','陀飞轮'], profile: '都市情感与时间感鲜明，适合克制地回望关系和生活。', genres: ['粤语流行','华语流行'], moods: ['克制','感伤'], scenes: ['深夜','城市漫步'] },
  { artist: '王菲', tracks: ['红豆','匆匆那年','传奇','我愿意','矜持'], profile: '空灵声线与留白感突出，适合安静、通透而不过度煽情的时刻。', genres: ['华语流行','另类流行'], moods: ['空灵','思念'], scenes: ['阅读','独处'] },
  { artist: '五月天', tracks: ['突然好想你','倔强','知足','温柔','你不是真正的快乐'], profile: '青春摇滚、陪伴和合唱感并存，既能释放情绪也能重新鼓起勇气。', genres: ['华语摇滚','流行摇滚'], moods: ['热烈','治愈'], scenes: ['公路','合唱'] },
  { artist: '孙燕姿', tracks: ['遇见','我怀念的','天黑黑','开始懂了','绿光'], profile: '清澈、坚韧又带成长感，适合通勤、回忆和重新出发。', genres: ['华语流行','抒情'], moods: ['清澈','成长'], scenes: ['通勤','清晨'] },
  { artist: '梁静茹', tracks: ['勇气','可惜不是你','宁夏','暖暖','分手快乐'], profile: '亲近温柔的情歌表达，适合陪伴、告白和慢慢放下。', genres: ['华语流行','情歌'], moods: ['温暖','释然'], scenes: ['睡前','约会'] },
  { artist: '陶喆', tracks: ['爱很简单','普通朋友','小镇姑娘','黑色柳丁','找自己'], profile: 'R&B 律动与城市叙事突出，松弛中保留鲜明个性。', genres: ['R&B','华语流行'], moods: ['松弛','真诚'], scenes: ['夜行','约会'] },
  { artist: 'Beyond', tracks: ['海阔天空','光辉岁月','喜欢你','真的爱你','不再犹豫'], profile: '理想、自由与真挚情感构成的粤语摇滚经典，适合重拾信念。', genres: ['粤语摇滚','流行摇滚'], moods: ['昂扬','真挚'], scenes: ['远行','鼓劲'] },
  { artist: '李宗盛', tracks: ['山丘','给自己的歌','凡人歌','鬼迷心窍','当爱已成往事'], profile: '以成熟叙事描摹关系与人生，适合沉淀、反思和与过去和解。', genres: ['华语流行','民谣'], moods: ['成熟','自省'], scenes: ['深夜','独处'] },
  { artist: '朴树', tracks: ['平凡之路','生如夏花','那些花儿','白桦林','New Boy'], profile: '少年感、远方和生命体悟交织，适合公路、转折和温柔怀旧。', genres: ['民谣摇滚','华语流行'], moods: ['自由','怀旧'], scenes: ['公路','黄昏'] },
  { artist: '许巍', tracks: ['蓝莲花','曾经的你','旅行','故乡','像风一样自由'], profile: '辽阔、坚定而松弛的摇滚表达，适合出发、远行和自我鼓励。', genres: ['华语摇滚','民谣摇滚'], moods: ['自由','坚定'], scenes: ['旅行','户外'] },
  { artist: '张学友', tracks: ['吻别','她来听我的演唱会','一千个伤心的理由','遥远的她','饿狼传说'], profile: '经典情歌与舞台张力兼备，适合浓烈怀旧和专注聆听。', genres: ['粤语流行','华语流行'], moods: ['深情','怀旧'], scenes: ['夜晚','K歌'] },
  { artist: '刘德华', tracks: ['忘情水','冰雨','谢谢你的爱','男人哭吧不是罪','练习'], profile: '真挚直接的经典流行表达，适合怀旧、打气和情绪释放。', genres: ['粤语流行','华语流行'], moods: ['真挚','坚定'], scenes: ['通勤','K歌'] },
  { artist: '黎明', tracks: ['今夜你会不会来','那有一天不想你','对不起我爱你','两个人的烟火','深秋的黎明'], profile: '都市浪漫与克制情绪并存，适合夜色、回忆和安静相处。', genres: ['粤语流行','华语流行'], moods: ['浪漫','克制'], scenes: ['夜行','约会'] },
  { artist: '郭富城', tracks: ['对你爱不完','我是不是该安静的走开','狂野之城','动起来','唱这歌'], profile: '舞曲能量与经典抒情交替，适合运动、聚会和复古情绪。', genres: ['粤语流行','舞曲'], moods: ['高能','怀旧'], scenes: ['运动','聚会'] },
  { artist: '邓丽君', tracks: ['月亮代表我的心','甜蜜蜜','我只在乎你','小城故事','但愿人长久'], profile: '温润、从容的华语经典，适合家庭陪伴、午后与柔软怀旧。', genres: ['华语经典','抒情'], moods: ['温柔','安宁'], scenes: ['午后','团聚'] },
  { artist: '张国荣', tracks: ['沉默是金','风继续吹','追','当年情','怪你过分美丽'], profile: '优雅、深情与戏剧气质交织，适合夜晚、电影感和长久回味。', genres: ['粤语流行','华语经典'], moods: ['优雅','深情'], scenes: ['夜晚','电影时刻'] },
  { artist: '梅艳芳', tracks: ['女人花','似是故人来','亲密爱人','夕阳之歌','一生爱你千百回'], profile: '成熟、坚韧且富舞台感，适合回望关系与感受女性力量。', genres: ['粤语流行','华语经典'], moods: ['成熟','坚韧'], scenes: ['独处','怀旧'] },
  { artist: '郑秀文', tracks: ['终身美丽','值得','眉飞色舞','出界','唉声叹气'], profile: '都市情歌和舞曲张力兼具，适合自我鼓励、夜行与聚会。', genres: ['粤语流行','舞曲'], moods: ['自信','都市'], scenes: ['夜行','运动'] },
  { artist: '莫文蔚', tracks: ['盛夏的果实','阴天','他不爱我','慢慢喜欢你','如果没有你'], profile: '慵懒、成熟而有叙事感，适合雨天、关系思考和缓慢靠近。', genres: ['华语流行','爵士流行'], moods: ['慵懒','感伤'], scenes: ['雨天','咖啡馆'] },
  { artist: '林忆莲', tracks: ['至少还有你','爱上一个不回家的人','伤痕','夜太黑','为你我受冷风吹'], profile: '都市女性视角与强情绪层次突出，适合深夜倾听和关系回望。', genres: ['华语流行','抒情'], moods: ['深情','坚韧'], scenes: ['深夜','独处'] },
  { artist: '那英', tracks: ['征服','默','梦一场','白天不懂夜的黑','一笑而过'], profile: '直接、有力量的情感表达，适合宣泄、告别和重新站稳。', genres: ['华语流行','抒情'], moods: ['有力','释然'], scenes: ['K歌','独处'] },
  { artist: '张惠妹', tracks: ['听海','记得','解脱','我最亲爱的','连名带姓'], profile: '强大人声与细腻情绪并重，适合释放压抑、拥抱真诚。', genres: ['华语流行','灵魂乐'], moods: ['浓烈','释放'], scenes: ['K歌','深夜'] },
  { artist: '蔡依林', tracks: ['倒带','日不落','说爱你','舞娘','大艺术家'], profile: '流行舞曲、态度和成长线并存，适合提振状态与自信出场。', genres: ['华语流行','舞曲'], moods: ['明亮','自信'], scenes: ['运动','聚会'] },
  { artist: '张韶涵', tracks: ['隐形的翅膀','欧若拉','淋雨一直走','遗失的美好','亲爱的那不是爱情'], profile: '明亮高音与成长主题鲜明，适合低谷鼓劲和青春回忆。', genres: ['华语流行','励志'], moods: ['希望','青春'], scenes: ['清晨','通勤'] },
  { artist: '邓紫棋', tracks: ['光年之外','泡沫','来自天堂的魔鬼','多远都要在一起','句号'], profile: '强烈声线、现代制作与情感爆发结合，适合专注聆听和释放。', genres: ['华语流行','电子流行'], moods: ['浓烈','坚定'], scenes: ['夜晚','运动'] },
  { artist: '田馥甄', tracks: ['小幸运','寂寞寂寞就好','你就不要想起我','魔鬼中的天使','无人知晓'], profile: '清醒、细腻又带独立气质，适合独处、成长和关系复盘。', genres: ['华语流行','另类流行'], moods: ['清醒','细腻'], scenes: ['独处','通勤'] },
  { artist: 'S.H.E', tracks: ['Super Star','中国话','美丽新世界','不想长大','一眼万年'], profile: '友情、青春和多元流行元素鲜明，适合合唱与轻快怀旧。', genres: ['华语流行','组合流行'], moods: ['青春','明亮'], scenes: ['聚会','通勤'] },
  { artist: 'F.I.R.飞儿乐团', tracks: ['Lydia','我们的爱','千年之恋','月牙湾','你的微笑'], profile: '华丽摇滚与青春幻想感结合，适合释放、奔跑和热烈回忆。', genres: ['流行摇滚','华语流行'], moods: ['热烈','幻想'], scenes: ['公路','运动'] },
  { artist: '王力宏', tracks: ['唯一','大城小爱','心跳','需要人陪','花田错'], profile: 'R&B、华语旋律与多元编曲融合，适合约会、城市漫步和轻松聆听。', genres: ['R&B','华语流行'], moods: ['浪漫','温暖'], scenes: ['约会','城市漫步'] },
  { artist: '林宥嘉', tracks: ['说谎','成全','想自由','兜圈','浪费'], profile: '细密情绪与迷幻质感并存，适合深夜、独处和复杂关系思考。', genres: ['华语流行','迷幻流行'], moods: ['迷惘','细腻'], scenes: ['深夜','独处'] },
  { artist: '薛之谦', tracks: ['演员','丑八怪','你还要我怎样','刚刚好','天外来物'], profile: '戏剧化叙事和强记忆旋律突出，适合情绪释放与都市夜晚。', genres: ['华语流行','抒情'], moods: ['戏剧','感伤'], scenes: ['夜行','K歌'] },
  { artist: '李荣浩', tracks: ['模特','年少有为','李白','戒烟','麻雀'], profile: '克制制作、都市观察和冷幽默并存，适合通勤与自省。', genres: ['华语流行','独立流行'], moods: ['克制','自省'], scenes: ['通勤','夜晚'] },
  { artist: '毛不易', tracks: ['消愁','像我这样的人','平凡的一天','借','无问'], profile: '平凡生活、温柔共情和朴素叙事突出，适合疲惫时被理解。', genres: ['民谣','华语流行'], moods: ['温柔','共情'], scenes: ['独处','回程'] },
  { artist: '陈粒', tracks: ['奇妙能力歌','易燃易爆炸','走马','小半','虚拟'], profile: '独立气质、意象和个性表达鲜明，适合夜晚沉浸与情绪探索。', genres: ['独立民谣','另类流行'], moods: ['神秘','自由'], scenes: ['深夜','阅读'] },
  { artist: '赵雷', tracks: ['成都','南方姑娘','我记得','阿刁','少年锦时'], profile: '城市、故乡与普通人的故事感浓厚，适合旅行和温暖怀旧。', genres: ['民谣','独立音乐'], moods: ['质朴','怀旧'], scenes: ['旅行','黄昏'] },
  { artist: '宋冬野', tracks: ['董小姐','安和桥','斑马斑马','莉莉安','郭源潮'], profile: '低沉叙事与城市民谣气质鲜明，适合夜晚、旧城和长时间独处。', genres: ['民谣','独立音乐'], moods: ['低沉','叙事'], scenes: ['深夜','城市漫步'] },
  { artist: '汪峰', tracks: ['春天里','怒放的生命','北京北京','存在','飞得更高'], profile: '现实感、生命力与大开大合的摇滚表达，适合鼓劲和释放。', genres: ['华语摇滚','流行摇滚'], moods: ['昂扬','现实'], scenes: ['公路','运动'] },
  { artist: '郑钧', tracks: ['灰姑娘','私奔','赤裸裸','回到拉萨','天下没有不散的筵席'], profile: '粗粝、自由而真诚的摇滚气质，适合远行、释放和率性时刻。', genres: ['华语摇滚','摇滚'], moods: ['自由','热烈'], scenes: ['远行','现场感'] },
  { artist: '崔健', tracks: ['一无所有','花房姑娘','新长征路上的摇滚','假行僧','从头再来'], profile: '先锋、现实批判和原始生命力构成华语摇滚的重要坐标。', genres: ['华语摇滚','先锋摇滚'], moods: ['锋利','有力'], scenes: ['专注聆听','现场感'] },
  { artist: '张楚', tracks: ['姐姐','孤独的人是可耻的','蚂蚁蚂蚁','爱情','冷暖自知'], profile: '诗性、孤独和个体观察突出，适合安静而专注的深度聆听。', genres: ['华语摇滚','另类摇滚'], moods: ['孤独','诗性'], scenes: ['深夜','阅读'] },
  { artist: '罗大佑', tracks: ['光阴的故事','恋曲1990','童年','皇后大道东','东方之珠'], profile: '时代观察、记忆和人文叙事深厚，适合怀旧与认真思考。', genres: ['华语经典','民谣摇滚'], moods: ['怀旧','人文'], scenes: ['午后','长途'] },
  { artist: '周华健', tracks: ['朋友','花心','风雨无阻','爱相随','让我欢喜让我忧'], profile: '亲切、明朗且适合合唱，能连接友情、陪伴和经典回忆。', genres: ['华语经典','华语流行'], moods: ['温暖','明朗'], scenes: ['朋友聚会','通勤'] },
  { artist: '齐秦', tracks: ['大约在冬季','夜夜夜夜','外面的世界','不让我的眼泪陪我过夜','往事随风'], profile: '清冷声线与漂泊感鲜明，适合冬夜、远方和克制怀旧。', genres: ['华语经典','抒情'], moods: ['清冷','怀旧'], scenes: ['冬夜','远行'] },
  { artist: '齐豫', tracks: ['橄榄树','欢颜','船歌','梦田','走在雨中'], profile: '空灵、诗意与世界音乐气质并存，适合阅读、自然和心绪放空。', genres: ['华语经典','民谣'], moods: ['空灵','诗意'], scenes: ['阅读','自然'] },
  { artist: '刘若英', tracks: ['后来','很爱很爱你','成全','当爱在靠近','一辈子的孤单'], profile: '平实叙事和成长型情感表达突出，适合回忆、释怀和自我陪伴。', genres: ['华语流行','抒情'], moods: ['温柔','释然'], scenes: ['独处','回程'] },
  { artist: '光良', tracks: ['童话','第一次','约定','都是你','烟火'], profile: '纯净旋律与温柔情歌气质鲜明，适合约会、回忆和安静陪伴。', genres: ['华语流行','情歌'], moods: ['纯净','浪漫'], scenes: ['约会','睡前'] }
];

const internationalCatalog: readonly ArtistCatalog[] = [
  { artist: 'The Beatles', tracks: ['Let It Be','Hey Jude','Yesterday'], profile: '旋律、合唱与时代感兼具的流行摇滚经典。', genres: ['rock','pop'], moods: ['comforting','nostalgic'], scenes: ['road trip','quiet evening'] },
  { artist: 'Queen', tracks: ['Bohemian Rhapsody',"Don't Stop Me Now",'We Will Rock You'], profile: '戏剧张力、华丽编曲与现场能量突出。', genres: ['rock','glam rock'], moods: ['dramatic','energizing'], scenes: ['workout','focused listening'] },
  { artist: 'Michael Jackson', tracks: ['Billie Jean','Beat It','Man in the Mirror'], profile: '节奏、流行制作与舞台表现力兼具。', genres: ['pop','funk'], moods: ['rhythmic','uplifting'], scenes: ['dance','night walk'] },
  { artist: 'Adele', tracks: ['Someone Like You','Hello','Rolling in the Deep'], profile: '强大人声与坦诚的情绪释放并重。', genres: ['pop soul','ballad'], moods: ['heartbroken','powerful'], scenes: ['quiet night','release'] },
  { artist: 'Coldplay', tracks: ['Yellow','Fix You','Viva la Vida'], profile: '温暖渐进、开阔旋律与希望感鲜明。', genres: ['alternative rock','pop rock'], moods: ['hopeful','warm'], scenes: ['night drive','recovery'] },
  { artist: 'Taylor Swift', tracks: ['Love Story','Blank Space','Anti-Hero'], profile: '清晰叙事、流行钩子与自我观察兼具。', genres: ['pop','singer-songwriter'], moods: ['romantic','self-aware'], scenes: ['commute','sing-along'] },
  { artist: 'Ed Sheeran', tracks: ['Photograph','Perfect','Shape of You'], profile: '亲密叙事、原声质感与现代流行节奏并存。', genres: ['pop','acoustic pop'], moods: ['tender','bright'], scenes: ['date night','travel'] },
  { artist: 'Bruno Mars', tracks: ['Just the Way You Are','Grenade','Locked Out of Heaven'], profile: '复古灵魂乐、强旋律和舞台能量突出。', genres: ['pop','R&B'], moods: ['romantic','energetic'], scenes: ['party','date night'] },
  { artist: 'Radiohead', tracks: ['Creep','Karma Police','No Surprises'], profile: '疏离感、另类摇滚和细腻不安构成深度沉浸。', genres: ['alternative rock','art rock'], moods: ['alienated','reflective'], scenes: ['late night','focused listening'] },
  { artist: 'Oasis', tracks: ['Wonderwall',"Don't Look Back in Anger",'Champagne Supernova'], profile: '英伦吉他、合唱感和青年怀旧气质鲜明。', genres: ['britpop','rock'], moods: ['nostalgic','anthemic'], scenes: ['sunset','friends'] },
  { artist: 'Nirvana', tracks: ['Smells Like Teen Spirit','Come as You Are','Lithium'], profile: '粗粝、反叛和强烈动态对比的另类摇滚。', genres: ['grunge','alternative rock'], moods: ['rebellious','intense'], scenes: ['release','workout'] },
  { artist: 'Elton John', tracks: ['Your Song','Rocket Man','Tiny Dancer'], profile: '钢琴旋律、经典创作与温暖戏剧性兼具。', genres: ['pop rock','singer-songwriter'], moods: ['warm','wistful'], scenes: ['road trip','quiet evening'] },
  { artist: 'John Lennon', tracks: ['Imagine','Jealous Guy','Woman'], profile: '理想主义、坦诚自省与简洁旋律并存。', genres: ['rock','singer-songwriter'], moods: ['peaceful','reflective'], scenes: ['thinking','quiet morning'] },
  { artist: 'Eagles', tracks: ['Hotel California','Desperado','Take It Easy'], profile: '公路气质、和声与经典摇滚叙事突出。', genres: ['classic rock','country rock'], moods: ['open-road','nostalgic'], scenes: ['road trip','sunset'] },
  { artist: 'Carpenters', tracks: ['Yesterday Once More','Top of the World','Close to You'], profile: '柔软和声、清澈旋律与温暖怀旧感鲜明。', genres: ['soft rock','pop'], moods: ['gentle','nostalgic'], scenes: ['afternoon','home'] },
  { artist: 'Whitney Houston', tracks: ['I Will Always Love You','Greatest Love of All','I Wanna Dance with Somebody'], profile: '强大人声、灵魂乐表达与明亮舞曲能量兼具。', genres: ['pop','soul'], moods: ['powerful','joyful'], scenes: ['sing-along','celebration'] },
  { artist: 'Celine Dion', tracks: ['My Heart Will Go On','Because You Loved Me','The Power of Love'], profile: '宏大抒情、电影感与高强度情绪推进突出。', genres: ['pop','power ballad'], moods: ['grand','romantic'], scenes: ['cinematic','quiet night'] },
  { artist: 'U2', tracks: ['With or Without You','One','Beautiful Day'], profile: '辽阔吉他、信念感和大型现场气质鲜明。', genres: ['rock','alternative rock'], moods: ['uplifting','yearning'], scenes: ['road trip','recovery'] },
  { artist: 'ABBA', tracks: ['Dancing Queen','Mamma Mia','The Winner Takes It All'], profile: '明亮旋律、舞曲节奏与隐藏的感伤并存。', genres: ['pop','disco'], moods: ['joyful','bittersweet'], scenes: ['party','sing-along'] },
  { artist: 'Bee Gees', tracks: ["Stayin' Alive",'How Deep Is Your Love','Night Fever'], profile: '迪斯科律动、和声与复古夜生活气质突出。', genres: ['disco','pop'], moods: ['groovy','romantic'], scenes: ['dance','night drive'] }
];

export const CLASSIC_KNOWLEDGE_SOURCE = 'bundled-curated-v2-300';

export function classicKnowledgeDocuments(): KnowledgeDocumentInput[] {
  const catalogs = [...zhCatalog, ...internationalCatalog];
  return catalogs.flatMap((catalog, catalogIndex) => catalog.tracks.map((title, trackIndex) => ({
    externalId: `classic-${String(catalogIndex + 1).padStart(2, '0')}-${String(trackIndex + 1).padStart(2, '0')}`,
    title,
    artist: catalog.artist,
    content: `${title} — ${catalog.artist}。${catalog.profile} 推荐场景：${catalog.scenes.join('、')}；情绪标签：${catalog.moods.join('、')}。`,
    metadata: {
      language: catalogIndex < zhCatalog.length ? 'zh' : 'international', genres: catalog.genres, moods: catalog.moods, scenes: catalog.scenes,
      provenance: 'bundled-editorial', verification: 'title-artist-curated; playback-still-requires-live-source-identity-check', catalogVersion: 2
    }
  })));
}

export function validateClassicKnowledgeDocuments(documents: KnowledgeDocumentInput[]) {
  if (documents.length !== 300) throw new Error(`经典知识目录应为 300 首，当前为 ${documents.length} 首。`);
  const keys = new Set<string>(); let zhCount = 0;
  for (const document of documents) {
    const key = `${document.title.normalize('NFKC').toLocaleLowerCase()}::${String(document.artist || '').normalize('NFKC').toLocaleLowerCase()}`;
    if (keys.has(key)) throw new Error(`经典知识目录存在重复歌曲：${document.title} — ${document.artist || ''}`); keys.add(key);
    if (document.metadata?.language === 'zh') zhCount += 1;
    if (!document.title.trim() || !document.artist?.trim() || document.content.length < 30) throw new Error(`经典知识目录字段不完整：${document.title}`);
  }
  if (zhCount !== 240) throw new Error(`经典知识目录应包含 240 首华语歌曲，当前为 ${zhCount} 首。`);
  return { total: documents.length, zh: zhCount, international: documents.length - zhCount };
}
