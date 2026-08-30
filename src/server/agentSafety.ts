export type AgentInputSafetyCategory = 'none' | 'crisis' | 'protected_data' | 'harmful_instructions';
export type AgentOutputSafetyCategory = 'none' | 'dependency' | 'professional_overreach';

export interface AgentInputSafetyDecision {
  category: AgentInputSafetyCategory;
  blocked: boolean;
  title?: string;
  response?: string;
}

const compact = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

const firstPersonCrisis = [
  /(?:我|本人).{0,12}(?:想死|不想活|活不下去|结束生命|自杀|伤害自己|割腕|跳楼)/,
  /(?:我要|我准备|我打算|我决定).{0,10}(?:自杀|去死|结束生命|割腕|跳楼|吞药)/,
  /^(?:想死|不想活了|活不下去了|我要自杀)[。！!，,\s]*$/,
  /\b(?:i|i'm|im)\b.{0,24}\b(?:kill myself|end my life|want to die|suicide|hurt myself|self[- ]harm)\b/i
];

const protectedRequests = [
  /(?:忽略|绕过|覆盖|无视).{0,18}(?:系统|开发者|安全|权限|以上).{0,10}(?:指令|规则|限制)/,
  /(?:显示|泄露|告诉|打印|导出|读取|发给我|提供给我).{0,28}(?:系统提示(?:词)?|开发者指令|隐藏指令|api\s*key|密钥|会话令牌|session\s*token|cookie|密码哈希|其他用户(?:的)?(?:数据|聊天(?:内容|记录)?|消息|记忆|歌单|收藏))/,
  /(?:把|将|给我).{0,48}(?:系统提示(?:词)?|开发者指令|隐藏指令|api\s*key|密钥|会话令牌|session\s*token|cookie|密码哈希|其他用户(?:的)?(?:数据|聊天(?:内容|记录)?|消息|记忆|歌单|收藏)).{0,24}(?:显示|泄露|告诉|打印|导出|读取|发给我|给我|提供|交给我)/,
  /^(?:请)?给我.{0,24}(?:系统提示(?:词)?|开发者指令|隐藏指令|api\s*key|密钥|会话令牌|session\s*token|cookie|密码哈希|其他用户(?:的)?(?:数据|聊天(?:内容|记录)?|消息|记忆|歌单|收藏))(?:全部)?[。！？!]*$/,
  /(?:执行|运行|发送).{0,12}(?:任意\s*(?:sql|url)|原始\s*sql|服务器命令|shell\s*命令)/,
  /(?:修改|重置).{0,8}(?:账户密码|登录密码)|(?:删除|注销).{0,8}(?:我的)?账户/
];

const harmfulInstructionRequests = [
  /(?:教我|给我步骤|具体步骤|怎么|如何).{0,24}(?:制作炸弹|制造爆炸物|下毒|入侵账户|窃取密码|绕过支付|实施勒索)/,
  /(?:帮我|替我).{0,20}(?:攻击|入侵|下毒|绑架|勒索).{0,20}(?:某人|别人|账号|网站|服务器)?/
];

export function inspectAgentInput(message: string): AgentInputSafetyDecision {
  const value = compact(message);
  if (firstPersonCrisis.some(pattern => pattern.test(value))) return {
    category: 'crisis', blocked: true, title: '先确保你此刻安全',
    response: '我很在意你刚才说的内容。先离开可能伤害自己的物品或危险地点，尽快联系一位你信任、能到你身边的人。如果你已经准备行动或正处在危险中，请立即联系当地急救或报警服务。你不需要独自扛着；我可以继续陪你把眼前几分钟拆成很小的步骤，但不能替代现实中的及时帮助。'
  };
  if (protectedRequests.some(pattern => pattern.test(value))) return {
    category: 'protected_data', blocked: true, title: '这项请求超出珍奇权限',
    response: '我不能读取或展示系统提示、密钥、会话、密码、其他用户数据，也不能执行任意 SQL、网址或服务器命令。我仍然可以使用脱敏状态帮你检查播放、推荐、导入和当前账户内的普通音乐数据。'
  };
  if (harmfulInstructionRequests.some(pattern => pattern.test(value))) return {
    category: 'harmful_instructions', blocked: true, title: '不能提供会直接伤害他人的步骤',
    response: '我不能帮助策划或执行伤害、入侵、勒索等行为。如果你是在处理真实风险，我可以帮你整理安全、合法的应对步骤，例如保护账户、保存证据或联系可信任的机构。'
  };
  return { category: 'none', blocked: false };
}

const dependencyPatterns = [
  /你只需要我/,
  /(?:只有|唯有)我.{0,16}(?:理解|懂|在乎|陪伴)你/,
  /我是你.{0,8}唯一.{0,8}(?:朋友|陪伴|依靠|需要)/,
  /不要.{0,18}(?:联系|相信|告诉).{0,12}(?:家人|朋友|医生|现实中的人|任何人)/,
  /离开.{0,12}(?:现实朋友|现实关系|家人).{0,12}(?:跟我|只和我)/
];

const professionalOverreachPatterns = [
  /(?:我确定|可以确定|你一定|你就是|你已经被诊断为|你患有).{0,24}(?:抑郁症|焦虑症|双相|精神分裂|人格障碍|癌症)/,
  /(?:停止|不要|不必).{0,10}(?:服药|看医生|就医|报警|联系律师)/,
  /(?:保证|肯定).{0,12}(?:赚钱|收益|赢官司|治愈|康复)/
];

export function inspectAgentOutput(text: string): AgentOutputSafetyCategory {
  const value = compact(text);
  if (dependencyPatterns.some(pattern => pattern.test(value))) return 'dependency';
  if (professionalOverreachPatterns.some(pattern => pattern.test(value))) return 'professional_overreach';
  return 'none';
}

const safeOutputReplacement = '我刚才的表述越过了应有边界。珍奇可以陪你梳理感受、音乐和下一步，但不会让你远离现实中的可信任关系，也不会冒充医生、律师或理财顾问。';

export class AgentOutputGuard {
  private pending = '';
  private stopped = false;
  category: AgentOutputSafetyCategory = 'none';

  push(delta: string): string[] {
    if (this.stopped || !delta) return [];
    this.pending += delta;
    const category = inspectAgentOutput(this.pending);
    if (category !== 'none') {
      this.category = category; this.pending = ''; this.stopped = true;
      return [safeOutputReplacement];
    }
    const output: string[] = [];
    let boundary = -1;
    for (let index = 0; index < this.pending.length; index += 1) if (/[。！？!?\n]/.test(this.pending[index])) boundary = index;
    if (boundary >= 0) { output.push(this.pending.slice(0, boundary + 1)); this.pending = this.pending.slice(boundary + 1); }
    else if (this.pending.length > 640) { output.push(this.pending.slice(0, 480)); this.pending = this.pending.slice(480); }
    return output;
  }

  finish(): string[] {
    if (this.stopped || !this.pending) return [];
    const category = inspectAgentOutput(this.pending);
    if (category !== 'none') { this.category = category; this.pending = ''; this.stopped = true; return [safeOutputReplacement]; }
    const output = this.pending; this.pending = ''; return [output];
  }

  get blocked() { return this.stopped; }
}
