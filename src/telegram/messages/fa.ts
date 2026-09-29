import {
  ANTE,
  CAP,
  CURRENCY_NAME,
  DAILY_AMOUNT,
  MAX_PLAYERS,
  MIN_JOIN_BALANCE,
  MIN_PLAYERS,
  TURN_SECONDS,
} from "../../config";
import type { Card, MatchState, PlayerState, Street } from "../../engine/types";
import { boardText, cardsText, escapeHtml, formatAmount, formatDurationFa, nameOf } from "./shared";
import type {
  ActivityView,
  BalanceView,
  HistoryView,
  KeyboardLabels,
  Lang,
  LeaderboardRow,
  LobbyView,
  Messages,
  StatsView,
} from "./types";

const STREET_LABEL: Record<Street, string> = {
  preflop: "پیش از فلاپ",
  flop: "فلاپ",
  turn: "ترن",
  river: "ریور",
  showdown: "شو-داون",
};

const HAND_LABEL: [string, string][] = [
  ["Straight flush", "استریت فلاش"],
  ["Four of a kind", "کاره"],
  ["Full house", "فول هاوس"],
  ["Flush", "فلاش"],
  ["Straight", "استریت"],
  ["Three of a kind", "تریپس"],
  ["Two pair", "دو جفت"],
  ["Pair", "جفت"],
  ["High card", "کارت بالا"],
];

function bestHandFa(name: string): string {
  for (const [prefix, label] of HAND_LABEL) {
    if (name.startsWith(prefix)) {
      return label;
    }
  }
  return name;
}

function headline(view: ActivityView): string {
  const { names, activity } = view;
  let text: string;
  switch (activity.type) {
    case "start": {
      const first = view.match.actorUserId;
      const name = first === null ? "—" : nameOf(names, first);
      text = `🚀 دست #${view.match.handNo} — ${name} اول بازی میکند`;
      break;
    }
    case "action": {
      const name = nameOf(names, activity.userId);
      switch (activity.kind) {
        case "fold":
          text = `❌ ${name} فولد کرد`;
          break;
        case "check":
          text = `✅ ${name} چک کرد`;
          break;
        case "call":
          text = `📞 ${name} کال کرد ${formatAmount(activity.to ?? 0)}`;
          break;
        case "bet":
          text = `🔥 ${name} شرط ${formatAmount(activity.to ?? 0)} بست`;
          break;
        case "raise":
          text = `🔥 ${name} تا ${formatAmount(activity.to ?? 0)} ریز کرد`;
          break;
        case "allin":
          text = `🚨 ${name} آل-این شد — ${formatAmount(activity.to ?? 0)}`;
          break;
      }
      break;
    }
    case "timeout": {
      const name = nameOf(names, activity.userId);
      const verb = activity.kind === "check" ? "چک کرد" : "فولد کرد";
      text = `⏰ وقت ${name} تمام شد — ${verb}`;
      break;
    }
    case "street":
      text = `🎲 ${STREET_LABEL[activity.street]}: ${cardsText(activity.cards)}`;
      break;
  }
  return text;
}

function stateLines(match: MatchState, names: Map<number, string>): string[] {
  const lines = [
    `🃏 دست #${match.handNo} — ${STREET_LABEL[match.street]} · 💰 پات ${formatAmount(
      match.pot,
    )} · سقف ${CAP}`,
  ];
  const board = boardText(match.board, "برد:");
  if (board) {
    lines.push("", board);
  }
  const seated = match.order
    .map((userId) => match.players.find((player) => player.userId === userId))
    .filter((player): player is PlayerState => player !== undefined);
  lines.push("", "در بازی");
  for (const player of seated) {
    if (player.folded) {
      continue;
    }
    const stack = player.allIn
      ? `آل-این ${formatAmount(player.contribution)}`
      : `در پات ${formatAmount(player.contribution)}`;
    const hole = match.revealed && player.hole ? ` — ${cardsText(player.hole)}` : "";
    lines.push(`${player.allIn ? "🚨" : "👤"} ${nameOf(names, player.userId)} — ${stack}${hole}`);
  }
  const out = seated.filter((player) => player.folded);
  if (out.length > 0) {
    lines.push("", "خارجشده");
    for (const player of out) {
      lines.push(`✖ ${nameOf(names, player.userId)} — در پات ${formatAmount(player.contribution)}`);
    }
  }
  return lines;
}

function nextLine(match: MatchState, names: Map<number, string>): string | null {
  if (match.status === "done") {
    return "⏭ دست تمام شد — نتیجه پایین";
  }
  if (match.runout) {
    return "⏭ در حال پخش کارتهای باقیمانده…";
  }
  if (match.actorUserId === null) {
    return null;
  }
  const actor = match.players.find((player) => player.userId === match.actorUserId);
  if (!actor) {
    return null;
  }
  const call = Math.max(0, match.currentBet - actor.streetContribution);
  const action = call > 0 ? `کال ${formatAmount(call)}` : "چک";
  return `⏭ نوبت: ${nameOf(names, actor.userId)} — ${action} · ${TURN_SECONDS} ثانیه`;
}

export const faLabels: KeyboardLabels = {
  join: "ورود",
  leave: "خروج",
  takeover: "🙋 شروعکننده شدن",
  deal: "🚀 پخش",
  cancel: "لغو",
  openBot: "📬 باز کردن ربات",
  cards: "🂠 کارتها",
  fold: "فولد",
  check: "چک",
  call: (amount) => `کال ${amount}`,
  raise: "ریز ▾",
  bet: (amount) => `شرط ${amount}`,
  raiseMin: (to) => `حداقل — تا ${to}`,
  raiseStep: (step, to) => `+${step} — تا ${to}`,
  allIn: (to) => `آل-این — ${to}`,
  custom: "✏️ دلخواه",
  showHand: "نمایش دست من",
  rematch: "🔁 بازی مجدد",
  resetGroup: "⚠️ پاک کردن این گروه",
};

export const fa: Messages = {
  labels: faLabels,

  pingText() {
    return "🏓 پونگ (dev)";
  },

  unknownGroupText() {
    return "متأسفم، این ربات خصوصی است و فقط در گروه مالکش بازی میکند.";
  },

  welcomeText() {
    return [
      "🃏 <b>به Daily Poker خوش آمدید!</b>",
      "",
      "من بازی پوکر را در گروه شما اجرا میکنم. کارتها و آمار شما در همین پیوی میآید.",
      "",
      `با /daily چیپ بگیرید (روزی یکبار، +${DAILY_AMOUNT}).`,
      "/rules /help /stats /balance /history",
    ].join("\n");
  },

  helpText(isDm: boolean) {
    const group = [
      "<b>دستورات گروه</b>",
      "/newmatch — باز کردن اتاق انتظار",
      "/join · /leave — ورود و خروج از اتاق",
      "/deal · /cancel — اقدام شروعکننده",
      "/takeover — شروعکننده شدن",
      "/fold · /check · /call · /raise 40 · /allin — شرطبندی",
      "/show — نمایش دست فولدشده",
      "/cards — ارسال دوباره کارتها در پیوی",
      "/balance · /top — چیپ و جدول امتیازات",
      "/rules — قوانین کامل",
      "/fa · /en — تغییر زبان ربات",
    ];
    const dm = [
      "<b>دستورات پیوی</b>",
      `/daily — دریافت ${DAILY_AMOUNT} چیپ`,
      "/balance · /stats · /history — آمار شما",
      "/cards — ارسال دوباره کارتهای شما",
      "/rules — قوانین کامل",
      "/fa · /en — تغییر زبان ربات",
    ];
    return [...(isDm ? dm : group), "", "فقط چیپ بازی — بدون پول واقعی."].join("\n");
  },

  rulesText() {
    return [
      "<b>قوانین Daily Poker</b>",
      "",
      `• هنگام پخش، هر نفر ورودی ${ANTE} میپردازد.`,
      `• سقف: هر بازیکن در هر دست حداکثر ${CAP} چیپ (ورودی هم حساب است) — رسیدن به سقف یعنی آل-این.`,
      "• شرطها و ریزها مضرب 10 هستند؛ حداقل ریز برابر ریز قبلی است.",
      `• هر اقدام ${TURN_SECONDS} ثانیه وقت دارد — با تمام شدن وقت، اگر کال لازم نباشد چک وگرنه فولد میشود.`,
      "• شو-داون: بهترین پنج کارت از هفت. برنده کارتهایش را نشان میدهد؛ بقیه میتوانند /show بزنند.",
      "• پات تقسیمی مساوی تقسیم میشود؛ چیپ اضافه به نفر اول ترتیب دست میرسد.",
      `• فقط چیپ بازی. وقتی کم آوردید با /daily روزانه +${DAILY_AMOUNT} بگیرید (برای بازی حداقل ${MIN_JOIN_BALANCE} لازم است).`,
    ].join("\n");
  },

  lobbyText(view: LobbyView) {
    if (view.expired) {
      return "⌛ <b>اتاق انتظار منقضی شد.</b>\nبا /newmatch بازی جدید بسازید.";
    }
    const starter =
      view.starterId === null
        ? "— (دکمه «شروعکننده شدن» را بزنید)"
        : nameOf(view.names, view.starterId);
    const joined = view.playerIds.map((id) => nameOf(view.names, id)).join("، ") || "—";
    const lines = [
      "🃏 <b>Daily Poker — اتاق انتظار</b>",
      `ورودی ${ANTE} برای هر نفر · حداکثر ${CAP} در هر دست · ${MIN_PLAYERS} تا ${MAX_PLAYERS} بازیکن`,
      "",
      `شروعکننده: ${starter}`,
      `عضوها (${view.playerIds.length}): ${joined}`,
    ];
    if (view.error) {
      lines.push("", `⚠️ ${escapeHtml(view.error)}`);
    } else if (view.playerIds.length < 2) {
      lines.push("", "در انتظار بازیکنان بیشتر…");
    } else {
      lines.push("", "آماده پخش.");
    }
    return lines.join("\n");
  },

  lobbyStartedText(handNo: number) {
    return `✅ دست #${handNo} شروع شد — ادامه در پیامهای بعدی.`;
  },

  activityText(view: ActivityView) {
    const lines = [`<b>${headline(view)}</b>`, "", ...stateLines(view.match, view.names)];
    const next = nextLine(view.match, view.names);
    if (next !== null) {
      lines.push("", next);
    }
    return lines.join("\n");
  },

  resultText(match, names, shown) {
    const winnerNames = match.winners.map((id) => nameOf(names, id));
    let line: string;
    if (match.winners.length > 1) {
      line = `🏆 <b>${winnerNames.join("، ")} پات ${formatAmount(match.pot)} را تقسیم کردند</b>`;
    } else {
      const delta = match.winners[0] === undefined ? 0 : (match.deltas[match.winners[0]] ?? 0);
      line = `🏆 <b>${winnerNames[0] ?? "—"} برنده ${formatAmount(match.pot)} شد (${
        delta >= 0 ? "+" : ""
      }${formatAmount(delta)})</b>`;
    }
    const winnerCards = match.winners
      .map((id) => {
        const player = match.players.find((candidate) => candidate.userId === id);
        return player?.shown ? player.hole : undefined;
      })
      .filter((hole): hole is [Card, Card] => hole !== undefined);
    if (winnerCards.length > 0) {
      line += ` — ${winnerCards.map((hole) => cardsText(hole)).join(" / ")}`;
    }
    const lines = [line];
    const board = boardText(match.board, "برد:");
    if (board) {
      lines.push(board);
    }
    for (const [userId, hole] of shown) {
      lines.push(`👁 ${nameOf(names, userId)} نشان داد ${cardsText(hole)}`);
    }
    return lines.join("\n");
  },

  dmCardsText(handNo: number, hole: [Card, Card]) {
    return [
      `🂠 <b>دست شما — دست #${handNo}</b>`,
      cardsText(hole),
      "",
      "برد و شرطبندی در گروه انجام میشود.",
    ].join("\n");
  },

  lobbyExpiredAlert() {
    return "این اتاق انتظار دیگر باز نیست. با /newmatch بازی جدید بسازید.";
  },

  notInMatchAlert() {
    return "شما در این دست نیستید";
  },

  notYourTurnAlert(name: string) {
    return `نوبت ${name} است`;
  },

  staleMoveAlert() {
    return "این حرکت دیگر در دسترس نیست";
  },

  needDmAlert() {
    return "اول باید پیوی من را باز کنید تا بتوانم کارتهایتان را بفرستم.";
  },

  joinedDmText() {
    return "شما داخل هستید! هنگام شروع دست، کارتهایتان را در پیوی میفرستم.";
  },

  noMatchAlert() {
    return "بازی فعالی وجود ندارد.";
  },

  matchOpenAlert() {
    return "یک بازی از قبل باز است";
  },

  matchActiveAlert() {
    return "یک دست در جریان است. اول آن را تمام کنید.";
  },

  needBalanceAlert() {
    return `برای بازی حداقل ${MIN_JOIN_BALANCE} ${CURRENCY_NAME} لازم دارید. با /daily دریافت کنید.`;
  },

  tableFullAlert() {
    return `میز پر است (${MAX_PLAYERS}/${MAX_PLAYERS})`;
  },

  alreadyJoinedAlert() {
    return "شما از قبل داخل هستید.";
  },

  onlyStarterAlert() {
    return "فقط شروعکننده میتواند این کار را انجام دهد.";
  },

  takeoverAlert() {
    return "الان نمیتوانید شروعکننده شوید.";
  },

  cardsNoneAlert() {
    return "الان کارتی در دست ندارید.";
  },

  showNoneAlert() {
    return "چیزی برای نشان دادن نیست.";
  },

  glitchAlert() {
    return "یک مشکل پیش آمد. دوباره امتحان کنید.";
  },

  amountMultipleAlert() {
    return "مبلغها باید مضرب 10 باشند";
  },

  raiseCapAlert(maxTo: number) {
    return `حداکثر میتوانید تا ${formatAmount(maxTo)} ریز کنید`;
  },

  noRaiseAlert() {
    return "الان نمیتوانید ریز کنید.";
  },

  raiseTypeText() {
    return "بنویسید: /raise <مبلغ> (مضرب 10).";
  },

  raisePickText() {
    return "یک مبلغ انتخاب کنید یا /raise <مبلغ> بنویسید.";
  },

  yourHandAlert(cards: string) {
    return `دست شما: ${cards}`;
  },

  inAlert() {
    return "شما داخل هستید.";
  },

  lobbyClosedText() {
    return "اتاق انتظار بسته شد.";
  },

  lobbyCanceledText() {
    return "اتاق انتظار لغو شد.";
  },

  needMorePlayersError() {
    return "برای پخش حداقل 2 بازیکن لازم است.";
  },

  playerBrokeError(name: string) {
    return `${name} چیپ کافی ندارد (حداقل ${MIN_JOIN_BALANCE} لازم است).`;
  },

  nothingPendingText() {
    return "چیزی برای تأیید نیست. اول /resetgroup را بفرستید.";
  },

  resetGroupPromptText(groupTitle: string | null, chatId: number) {
    const group = groupTitle === null ? "این گروه" : `<b>${escapeHtml(groupTitle)}</b>`;
    return [
      `⚠️ همهٔ دادههای ${group} (${chatId}) پاک شود؟`,
      "",
      "بازیکنان، موجودیها، آمار و تاریخچه پاک میشوند و بازگشتپذیر نیست.",
      "",
      "دکمه را بزنید، سپس RESET را تایپ کنید.",
    ].join("\n");
  },

  resetGroupArmedText() {
    return "⚠️ تأیید فعال شد. برای پاک کردن همین حالا RESET را تایپ کنید.";
  },

  resetGroupMismatchText() {
    return "متن تأیید درست نیست. دقیقاً RESET را تایپ کنید.";
  },

  dailyClaimedText(balance: number) {
    return `✅ +${DAILY_AMOUNT} چیپ دریافت شد. موجودی: ${formatAmount(
      balance,
    )}. دریافت بعدی در 24 ساعت.`;
  },

  dailyTooEarlyText(remainingMs: number) {
    return `⏳ قبلاً دریافت کردهاید. دریافت بعدی در ${formatDurationFa(remainingMs)}.`;
  },

  dailyTeaserText(name: string) {
    return `🎁 ${escapeHtml(name)} چیپ روزانهاش را گرفت.`;
  },

  dailyStatus(lastDailyAt: number | null, now: number, cooldownMs: number) {
    if (lastDailyAt === null || now - lastDailyAt >= cooldownMs) {
      return "همین حالا آماده";
    }
    return `در ${formatDurationFa(cooldownMs - (now - lastDailyAt))}`;
  },

  balanceText(view: BalanceView, cooldownMs: number) {
    const net = view.chipsWon - view.chipsLost;
    return [
      `💰 موجودی: ${formatAmount(view.balance)} ${CURRENCY_NAME}`,
      `🌅 روزانه: ${this.dailyStatus(view.lastDailyAt, view.now, cooldownMs)}`,
      `📈 کارنامه: ${view.handsPlayed} دست · ${view.handsWon} برد · ${
        net >= 0 ? "+" : ""
      }${formatAmount(net)} ${CURRENCY_NAME}`,
    ].join("\n");
  },

  statsText(player: StatsView, groupTitle: string | null) {
    const net = player.chipsWon - player.chipsLost;
    const winRate =
      player.handsPlayed === 0 ? 0 : Math.round((player.handsWon / player.handsPlayed) * 100);
    const lines = [
      `📊 <b>آمار شما${groupTitle ? ` — ${escapeHtml(groupTitle)}` : ""}</b>`,
      `دستها: ${player.handsPlayed} · بردها: ${player.handsWon} (${winRate}%)`,
      `خالص: ${net >= 0 ? "+" : ""}${formatAmount(net)} · بزرگترین پات: ${formatAmount(
        player.biggestPot,
      )}`,
    ];
    if (player.bestHand) {
      lines.push(`بهترین دست: ${escapeHtml(bestHandFa(player.bestHand))}`);
    }
    return lines.join("\n");
  },

  historyText(rows: HistoryView[]) {
    if (rows.length === 0) {
      return "📜 هنوز دستی بازی نشده.";
    }
    const lines = ["📜 <b>آخرین دستها</b>"];
    for (const row of rows) {
      const marker = row.won ? "🏆" : "💔";
      const sign = row.delta >= 0 ? "+" : "−";
      const parts = [`#${row.handNo}`, marker, `${sign}${formatAmount(Math.abs(row.delta))}`];
      if (row.hole) {
        parts.push(cardsText(row.hole));
      }
      if (row.board.length > 0) {
        parts.push(`برد: ${cardsText(row.board)}`);
      }
      lines.push(parts.join("  "));
    }
    return lines.join("\n");
  },

  leaderboardText(rows: LeaderboardRow[], groupTitle: string | null) {
    const lines = [`🏆 <b>جدول امتیازات${groupTitle ? ` — ${escapeHtml(groupTitle)}` : ""}</b>`];
    if (rows.length === 0) {
      lines.push("هنوز کسی چیپی نگرفته.");
      return lines.join("\n");
    }
    rows.forEach((row, index) => {
      lines.push(`${index + 1}. ${escapeHtml(row.firstName)}  ${formatAmount(row.balance)}`);
    });
    return lines.join("\n");
  },

  versionText(version: string, webhookUrl: string | null, pending: number) {
    return [
      `🤖 dailypoker.bot v${version}`,
      `وبهوک: ${webhookUrl ?? "تنظیم نشده"}`,
      `آپدیتهای در انتظار: ${pending}`,
    ].join("\n");
  },

  resetGroupDoneText(chatId: number) {
    return `🧹 گروه ${chatId} پاک شد.`;
  },

  ownerOnlyText() {
    return "فقط مالک.";
  },

  languageSetText(lang: Lang) {
    return lang === "fa"
      ? "✅ زبان ربات به فارسی تغییر کرد."
      : "✅ زبان ربات به انگلیسی تغییر کرد.";
  },
};
