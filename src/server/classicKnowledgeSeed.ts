import type { Db } from './db.js';
import { publishKnowledgeVersion, type KnowledgeDocumentInput } from './agentKnowledge.js';

const zh = [
  ['晴天','周杰伦','青涩回忆、校园、雨天；适合怀旧和安静独处。'],['稻香','周杰伦','温暖、回家与重新出发；适合疲惫时找回轻松感。'],['夜曲','周杰伦','夜色、思念、戏剧张力；适合深夜沉浸。'],['七里香','周杰伦','夏日、初恋、清甜；适合傍晚散步。'],['退后','周杰伦','遗憾、克制、关系结束；适合需要被理解的低落时刻。'],['青花瓷','周杰伦','古典意象、含蓄、东方氛围；适合安静阅读。'],
  ['江南','林俊杰','抒情、宿命感、细腻；适合怀旧和情绪沉淀。'],['她说','林俊杰','倾听、失落、温柔；适合一个人慢慢消化心事。'],['修炼爱情','林俊杰','成长、失去、深情；适合夜晚回望关系。'],['可惜没如果','林俊杰','错过、反思、情绪推进；适合想释放遗憾时。'],
  ['十年','陈奕迅','时间、重逢、告别；适合克制的怀旧。'],['好久不见','陈奕迅','城市重逢、想念、平静；适合夜行和独处。'],['红玫瑰','陈奕迅','欲望、距离、复杂关系；适合深夜沉浸。'],['孤勇者','陈奕迅','勇气、逆境、昂扬；适合需要鼓劲时。'],
  ['红豆','王菲','等待、思念、通透；适合安静的情感陪伴。'],['匆匆那年','王菲','青春、错过、回望；适合回忆旧时光。'],['传奇','王菲','相遇、空灵、温柔；适合安静相处。'],
  ['突然好想你','五月天','强烈想念、青春、释放；适合需要宣泄时。'],['倔强','五月天','坚持、少年感、向前；适合低谷打气。'],['知足','五月天','温柔、珍惜、释然；适合黄昏和回程。'],['温柔','五月天','告别、体谅、柔软；适合情绪缓慢落地。'],
  ['遇见','孙燕姿','期待、缘分、清澈；适合通勤和轻盈独处。'],['我怀念的','孙燕姿','失去、怀念、情绪爆发；适合想认真哭一场时。'],['天黑黑','孙燕姿','成长、乡愁、安慰；适合疲惫时回到内心。'],
  ['勇气','梁静茹','告白、陪伴、坚定；适合需要迈出一步时。'],['可惜不是你','梁静茹','错过、感谢、释怀；适合安静回忆。'],['宁夏','梁静茹','夏夜、轻柔、安心；适合睡前放松。'],
  ['爱很简单','陶喆','真诚、松弛、R&B；适合轻松约会。'],['普通朋友','陶喆','关系边界、遗憾、律动；适合城市夜晚。'],['小镇姑娘','陶喆','成长、故事感、节奏；适合公路与通勤。'],
  ['海阔天空','Beyond','理想、坚持、辽阔；适合重新振作。'],['光辉岁月','Beyond','尊严、和平、力量；适合需要信念时。'],['喜欢你','Beyond','真挚、明亮、摇滚抒情；适合表达心意。'],
  ['山丘','李宗盛','人生、时间、自省；适合成熟而安静的夜晚。'],['给自己的歌','李宗盛','告别、体悟、克制；适合与过去和解。'],['凡人歌','李宗盛','现实、洒脱、人生况味；适合通勤和自嘲。'],
  ['平凡之路','朴树','出发、迷惘、和解；适合公路和人生转折。'],['生如夏花','朴树','生命感、热烈、诗意；适合想重新感受世界时。'],['那些花儿','朴树','青春、朋友、远方；适合温柔怀旧。'],
  ['蓝莲花','许巍','自由、坚定、远行；适合出发和自我鼓励。'],['曾经的你','许巍','青春、远方、成长；适合公路旅行。'],['旅行','许巍','松弛、自然、远方；适合散步和周末。']
] as const;

const international = [
  ['Let It Be','The Beatles','安慰、接纳、经典摇滚；适合焦虑时放松。'],['Hey Jude','The Beatles','鼓励、合唱、逐渐昂扬；适合需要陪伴与力量时。'],['Bohemian Rhapsody','Queen','戏剧化、摇滚、结构变化；适合专注聆听。'],["Don't Stop Me Now",'Queen','高能、自由、明亮；适合运动和提振状态。'],['Billie Jean','Michael Jackson','律动、神秘、流行经典；适合夜间步行。'],['Someone Like You','Adele','失恋、告别、坦诚；适合安静释放情绪。'],['Yellow','Coldplay','温暖、仰望、真挚；适合夜晚和陪伴。'],['Fix You','Coldplay','修复、渐进、希望；适合低谷和需要安慰时。'],['Love Story','Taylor Swift','青春、浪漫、明亮；适合轻松出行。'],['Photograph','Ed Sheeran','回忆、距离、温柔；适合想念某人时。'],['Just the Way You Are','Bruno Mars','欣赏、告白、甜蜜；适合约会氛围。'],['Creep','Radiohead','疏离、自我怀疑、另类摇滚；适合情绪沉浸。'],['Wonderwall','Oasis','英伦、陪伴、怀旧；适合朋友聚会或黄昏。'],['Smells Like Teen Spirit','Nirvana','爆发、反叛、摇滚；适合释放压力。'],['Your Song','Elton John','真诚、温暖、经典；适合安静表达爱意。'],['Imagine','John Lennon','和平、理想、平静；适合思考与放空。'],['Hotel California','Eagles','公路、神秘、经典摇滚；适合长途夜行。'],['Yesterday Once More','Carpenters','旧日旋律、柔软怀旧；适合午后回忆。'],['I Will Always Love You','Whitney Houston','深情、告别、强大人声；适合情绪高潮。'],['My Heart Will Go On','Celine Dion','永恒、思念、电影感；适合宏大抒情时刻。']
] as const;

export function ensureClassicKnowledgeSeed(db: Db) {
  if (process.env.AGENT_SEED_CLASSIC === 'false' || db.prepare("SELECT 1 FROM knowledge_versions WHERE kind='classic' AND status='active'").get()) return;
  const documents: KnowledgeDocumentInput[] = [...zh, ...international].map(([title, artist, content], index) => ({ externalId: `golden-${String(index + 1).padStart(3, '0')}`, title, artist, content: `${title} — ${artist}。${content}`, metadata: { language: index < zh.length ? 'zh' : 'international', verified: 'bundled-golden-set' } }));
  publishKnowledgeVersion(db, { kind: 'classic', source: 'bundled-golden-v1', collectedAt: new Date().toISOString(), documents });
}
