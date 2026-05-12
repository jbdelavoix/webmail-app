function t(pathKey, replacements) {
  if (!window?.electronAPI?.t) return pathKey;
  return window.electronAPI.t(pathKey, replacements);
}

function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

const PRESET_META = {
  gmail: {
    url: "https://mail.google.com",
    icon: "simple-icons:gmail",
  },
  outlook: {
    url: "https://outlook.office365.com/mail/inbox",
    icon: "simple-icons:microsoftoutlook",
  },
  icloud: {
    url: "https://mail.icloud.com",
    icon: "simple-icons:icloud",
  },
  yahoo: {
    url: "https://mail.yahoo.com",
    icon: "simple-icons:yahoo",
  },
};

function buildPresetProviders() {
  return Object.fromEntries(
    Object.keys(PRESET_META).map((key) => [
      key,
      {
        name: t(`providers.${key}.name`),
        ...PRESET_META[key],
      },
    ]),
  );
}

const PROVIDERS = buildPresetProviders();

function presetDefaultUrl(providerKey) {
  return PRESET_META[providerKey]?.url ?? "";
}

function normalizePersistedAccounts(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((a) => {
    const legacyCustom =
      typeof a.provider === "string" &&
      a.provider.startsWith("custom-") &&
      !a.providerMeta;

    const next =
      legacyCustom ? { ...a, provider: "custom" } : { ...a };

    const needsMeta =
      !next.providerMeta &&
      (next.provider === "custom" || legacyCustom);

    if (needsMeta) {
      next.providerMeta = {
        name:
          next.customName || t("app.customAccountFallbackName"),
        url: next.customUrl || "",
        icon: "mdi:email",
      };
    }

    return next;
  });
}

function getProviderInfo(account) {
  if (!account) return null;

  const preset = PROVIDERS[account.provider];
  if (preset && account.provider !== "custom") {
    return preset;
  }

  if (account.providerMeta) {
    return account.providerMeta;
  }

  if (account.provider === "custom") {
    return {
      name:
        account.customName || t("app.customAccountFallbackName"),
      url: account.customUrl || "",
      icon: "mdi:email",
    };
  }

  return preset || null;
}

/** Label shown in sidebars when the user sets a custom display name. */
function accountDisplayTitle(account, provider) {
  if (!account) return "";

  const raw = account.customName;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }

  return provider?.name || "";
}

const persistedAccounts = JSON.parse(
  localStorage.getItem("accounts") || "[]",
);
const migratedAccounts =
  normalizePersistedAccounts(persistedAccounts);
if (
  JSON.stringify(persistedAccounts) !== JSON.stringify(migratedAccounts)
) {
  localStorage.setItem("accounts", JSON.stringify(migratedAccounts));
}

// State management
const state = {
  accounts: migratedAccounts,
  activeAccountId: localStorage.getItem("activeAccountId") || null,
  /** @type {'general' | 'add' | number | null} Master column selection in Settings. */
  settingsSidebarSelection: null,
  inSettingsMode: false,
  webviews: new Map(),
};

/** Where the mailbox strip sits: `top` (horizontal) or `side` (vertical next to webviews). */
const LayoutPrefs = {
  tabBarPosition: "top",
  setTabBarPosition(mode) {
    this.tabBarPosition = mode === "side" ? "side" : "top";
  },
};

/** Same widths / rhythm as the mailbox strip so Settings aligns with the mail layout. */
const MAIL_CHROME = {
  /** Icon-first tabs: minimal strip width (swatch 32px + padding). */
  sideRailWidthClass: "w-14",
  /** macOS vertical: wider strip so traffic lights sit inside the chrome rail. */
  sideRailWidthClassDarwin: "w-20",
};

function verticalSideRailWidthClass(darwin) {
  return darwin ? MAIL_CHROME.sideRailWidthClassDarwin : MAIL_CHROME.sideRailWidthClass;
}

/** `placement`: `"side"` = bubble to the right of the icon (vertical bar); `"below"` = under the icon (top bar). */
function layoutAccountTabTooltip(anchorEl, tipRootEl, placement) {
  const r = anchorEl.getBoundingClientRect();
  const gap = 6;
  const pad = 8;
  tipRootEl.style.position = "fixed";
  tipRootEl.style.zIndex = "10002";
  tipRootEl.style.bottom = "";

  if (placement === "below") {
    tipRootEl.style.transform = "translateX(-50%)";
    const cx = r.left + r.width / 2;
    tipRootEl.style.left = `${Math.round(cx)}px`;
    tipRootEl.style.top = `${Math.round(r.bottom + gap)}px`;
    const tr = tipRootEl.getBoundingClientRect();
    let dx = 0;
    if (tr.left < pad) dx += pad - tr.left;
    if (tr.right > window.innerWidth - pad)
      dx -= tr.right - (window.innerWidth - pad);
    if (dx !== 0) {
      tipRootEl.style.left = `${Math.round(cx + dx)}px`;
    }
    return;
  }

  tipRootEl.style.transform = "translateY(-50%)";
  tipRootEl.style.top = `${Math.round(r.top + r.height / 2)}px`;
  tipRootEl.style.left = `${Math.round(r.right + gap)}px`;
  const tr = tipRootEl.getBoundingClientRect();
  if (tr.right > window.innerWidth - pad) {
    tipRootEl.style.left = `${Math.round(window.innerWidth - pad - tr.width)}px`;
  }
  if (tr.left < pad) {
    tipRootEl.style.left = `${pad}px`;
  }
}

// Theme: uiAppearance preference (system light dark) overrides matchMedia when not "system".
const ThemeManager = {
  appearanceMode: "system",

  setAppearanceMode(mode) {
    this.appearanceMode = ["system", "light", "dark"].includes(mode)
      ? mode
      : "system";
  },

  matchesSystemDark() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  },

  isDark() {
    if (this.appearanceMode === "dark") return true;
    if (this.appearanceMode === "light") return false;
    return this.matchesSystemDark();
  },

  init() {
    this.applyTheme();
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        if (this.appearanceMode !== "system") return;
        this.applyTheme();
        SidebarUI.render();
        if (state.inSettingsMode) {
          SettingsUI.show();
        }
      });
  },

  applyTheme() {
    const isDark = this.isDark();
    const html = document.documentElement;
    html.setAttribute("data-theme", isDark ? "dark" : "light");

    if (isDark) {
      html.classList.remove("bg-white", "text-slate-900");
      html.classList.add("bg-slate-900", "text-slate-100");
      document.body.className = "h-screen bg-slate-900 text-slate-100";
    } else {
      html.classList.remove("bg-slate-900", "text-slate-100");
      html.classList.add("bg-white", "text-slate-900");
      document.body.className = "h-screen bg-white text-slate-900";
    }

    queueMicrotask(() => TopAccountBar.render());
  },
};

// Account management
const AccountManager = {
  save() {
    localStorage.setItem("accounts", JSON.stringify(state.accounts));
    localStorage.setItem("activeAccountId", state.activeAccountId);
  },

  add(providerKey) {
    if (!PRESET_META[providerKey]) return null;

    const id = Date.now();
    state.accounts.push({
      id,
      provider: providerKey,
      partition: `persist:${providerKey}-${id}`,
      unreadCount: 0,
    });
    this.save();
    return id;
  },

  addCustom(providerMeta) {
    const id = Date.now();
    state.accounts.push({
      id,
      provider: "custom",
      providerMeta: {
        name: providerMeta.name,
        url: providerMeta.url,
        icon: providerMeta.icon || "mdi:email",
      },
      partition: `persist:custom-${id}`,
      unreadCount: 0,
    });
    this.save();
    return id;
  },

  delete(accountId) {
    const webview = state.webviews.get(accountId);
    if (webview) {
      webview.remove();
      state.webviews.delete(accountId);
    }

    state.accounts = state.accounts.filter((a) => a.id !== accountId);

    if (state.activeAccountId == accountId) {
      state.activeAccountId = null;
    }

    this.save();
    UnreadCountManager.sendTotalCount();
    return true;
  },

  update(accountId, changes) {
    const account = state.accounts.find((a) => a.id == accountId);
    if (account) {
      const previousUnread = account.unreadCount;
      Object.assign(account, changes);
      this.save();
      if (changes.unreadCount !== undefined && changes.unreadCount !== previousUnread) {
        SidebarUI.render();
        UnreadCountManager.sendTotalCount();
      }
    }
  },

  get(accountId) {
    if (!accountId) return null;
    return state.accounts.find((a) => a.id == accountId);
  },
};

const UnreadCountManager = {
  sendTotalCount() {
    const totalUnread = state.accounts.reduce(
      (sum, account) => sum + (account.unreadCount || 0),
      0,
    );

    if (window?.electronAPI?.sendUnreadCount) {
      window.electronAPI.sendUnreadCount(totalUnread);
    }
  },
};

// UI utilities
const UI = {
  getColor(id) {
    const account = AccountManager.get(id);
    if (account?.customColor) return account.customColor;
    const hue = (id * 137) % 360;
    const isDark = ThemeManager.isDark();
    const lightness = isDark ? 50 : 45;
    return `hsl(${hue}, 70%, ${lightness}%)`;
  },

  getThemeClass(dark, light) {
    return ThemeManager.isDark() ? dark : light;
  },

  getUrl(account) {
    const custom = account.customUrl && account.customUrl.trim();
    if (custom) return custom;

    const info = getProviderInfo(account);
    if (info && info.url) return info.url;
    return "about:blank";
  },

  bgClass() {
    return this.getThemeClass("bg-slate-800", "bg-slate-100");
  },

  borderClass() {
    return this.getThemeClass("border-slate-700", "border-slate-300");
  },

  textMutedClass() {
    return this.getThemeClass("text-slate-400", "text-slate-600");
  },

  inputBgClass() {
    return this.getThemeClass(
      "bg-slate-700 border-slate-600",
      "bg-slate-50 border-slate-300",
    );
  },

  hoverClass() {
    return this.getThemeClass("hover:bg-slate-700", "hover:bg-slate-200");
  },

  buttonClass(variant = "default") {
    if (variant === "secondary") {
      return this.getThemeClass(
        "bg-slate-700 hover:bg-slate-600",
        "bg-slate-200 hover:bg-slate-300",
      );
    }
    return this.getThemeClass(
      "bg-slate-700 hover:bg-slate-600",
      "bg-slate-200 hover:bg-slate-300",
    );
  },

  dividerClass() {
    return this.getThemeClass(
      "border-slate-600/75",
      "border-slate-200",
    );
  },

  sidebarStripClass() {
    return this.getThemeClass(
      "bg-slate-950 border-slate-800",
      "bg-slate-50 border-slate-200",
    );
  },
};

// Webview management
const WebviewManager = {
  create(account) {
    const mainContent = document.getElementById("main-content");
    const webview = document.createElement("webview");
    webview.id = `webview-${account.id}`;
    webview.className = "flex min-h-0 min-w-0 flex-1 flex-col";
    webview.src = UI.getUrl(account);
    webview.partition = account.partition;
    webview.style.display =
      state.activeAccountId == account.id ? "flex" : "none";

    webview.addEventListener("dom-ready", () => {
      WebviewManager.parseUnreadCount(account);
    });

    webview.addEventListener("page-title-updated", () => {
      WebviewManager.parseUnreadCount(account);
    });

    webview.addEventListener("context-menu", (e) => {
      if (!window.electronAPI?.openContextMenu) return;

      e.preventDefault();

      const params = e.params;
      let x = params?.x;
      let y = params?.y;
      if (typeof x === "number" && typeof y === "number") {
        const rect = webview.getBoundingClientRect();
        x = Math.round(rect.left + x);
        y = Math.round(rect.top + y);
      }

      window.electronAPI.openContextMenu(x, y);
    });

    mainContent.appendChild(webview);
    state.webviews.set(account.id, webview);
  },

  switchTo(accountId) {
    state.activeAccountId = accountId;
    AccountManager.save();

    state.webviews.forEach((webview, id) => {
      webview.style.display = id == accountId ? "flex" : "none";
    });

    SidebarUI.render();
  },

  parseUnreadCount(account) {
    const webview = state.webviews.get(account.id);
    if (!webview) return;

    webview
      .executeJavaScript(`document.title`)
      .then((title) => {
        title = title || "";
        const match = title.match(/\((\d+)\)/);
        const unreadCount = match ? Number(match[1]) : 0;
        AccountManager.update(account.id, { unreadCount });
      });
  },
};

// Mailbox chrome: tabs + settings share `#chrome-root` (no separate left rail).
const TopAccountBar = {
  styleSettingsBtn(btn, isDark, vertical) {
    if (!btn) return;
    const inSettings = state.inSettingsMode;
    btn.title = t("ui.settingsTooltip");
    const ringOff = isDark
      ? "focus-visible:ring-offset-slate-950"
      : "focus-visible:ring-offset-white";

    btn.setAttribute("aria-pressed", inSettings ? "true" : "false");

    if (vertical) {
      btn.className =
        `chrome-settings-btn chrome-settings-btn--rail flex h-11 w-full shrink-0 items-center justify-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/45 ${ringOff} py-2.5`;
    } else {
      btn.className =
        `chrome-settings-btn chrome-settings-btn--strip flex h-11 w-11 shrink-0 items-center justify-center rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/45 ${ringOff}`;
    }
  },

  render() {
    const bar = document.getElementById("account-tab-bar");
    const windowSplit = document.getElementById("window-split");
    const chromeRoot = document.getElementById("chrome-root");
    const settingsBtn = document.getElementById("settings-btn");
    if (!bar || !windowSplit || !chromeRoot || !settingsBtn) return;

    if (TopAccountBar._teardownViewportTips) {
      TopAccountBar._teardownViewportTips();
      TopAccountBar._teardownViewportTips = null;
    }

    const isDark = ThemeManager.isDark();
    const vertical = LayoutPrefs.tabBarPosition === "side";
    const darwin =
      typeof window?.electronAPI?.platform === "string" &&
      window.electronAPI.platform === "darwin";
    const padH = darwin ? "pl-[4.5rem]" : "pl-4";
    const tone = isDark
      ? "border-slate-800 bg-slate-950"
      : "border-slate-200 bg-white";

    const showTabs = state.accounts.length > 0;

    windowSplit.className = vertical
      ? "flex min-h-0 flex-1 flex-row overflow-hidden"
      : "flex min-h-0 flex-1 flex-col overflow-hidden";

    if (!showTabs) {
      bar.innerHTML = "";
      bar.style.display = "none";
      bar.removeAttribute("role");
      bar.removeAttribute("aria-label");
      bar.setAttribute("aria-hidden", "true");
      if (vertical) {
        chromeRoot.className =
          `flex h-full min-h-0 ${verticalSideRailWidthClass(darwin)} shrink-0 flex-col justify-end border-r ${tone}`;
      } else {
        chromeRoot.className =
          `flex min-h-0 shrink-0 flex-row items-center justify-end border-b ${tone} ${padH} py-3`;
      }
      this.styleSettingsBtn(settingsBtn, isDark, vertical);
      return;
    }

    bar.style.display = "flex";
    bar.setAttribute("role", "tablist");
    bar.setAttribute("aria-label", t("ui.mailTablistLabel"));
    bar.setAttribute("aria-hidden", "false");

    if (vertical) {
      chromeRoot.className =
        `flex h-full min-h-0 ${verticalSideRailWidthClass(darwin)} shrink-0 flex-col border-r ${tone}`;
      bar.className = [
        "account-tab-bar flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2",
        darwin ? "pb-2 pt-10" : "py-2",
      ].join(" ");
    } else {
      chromeRoot.className =
        `flex min-h-0 shrink-0 flex-row items-center border-b ${tone}`;
      bar.className = [
        "account-tab-bar flex flex-1 min-w-0 flex-row flex-nowrap items-center gap-3 overflow-x-auto px-1 py-3",
        padH,
        "pr-3",
      ].join(" ");
    }

    bar.innerHTML = "";

    state.accounts.forEach((account) => {
      const provider = getProviderInfo(account);
      if (!provider) return;

      const isMailActive =
        !state.inSettingsMode && account.id == state.activeAccountId;
      const displayName = accountDisplayTitle(account, provider);
      const rawIcon =
        typeof provider.icon === "string" && provider.icon.trim().length > 0
          ? provider.icon.trim()
          : "mdi:email";

      const unread =
        typeof account.unreadCount === "number" && account.unreadCount > 0
          ? account.unreadCount
          : 0;

      const tab = document.createElement("button");
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", isMailActive ? "true" : "false");
      tab.title =
        unread > 0
          ? `${displayName} · ${t("ui.unreadAbbrev", { n: unread })}`
          : displayName;

      const ringOff = isDark
        ? "focus-visible:ring-offset-slate-950"
        : "focus-visible:ring-offset-white";

      const tipPlacement = vertical ? "side" : "below";

      if (vertical) {
        tab.className =
          `account-tab-button relative flex w-full min-w-0 flex-col items-center justify-center overflow-visible rounded-xl px-2 py-2.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/45 ${ringOff}`;
      } else {
        tab.className =
          `account-tab-button relative flex h-11 shrink-0 flex-row flex-nowrap items-center justify-center overflow-visible rounded-xl px-2 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/45 ${ringOff}`;
      }

      tab.onclick = () => {
        if (state.inSettingsMode) {
          state.activeAccountId = account.id;
          AccountManager.save();
          SettingsUI.hide();
        } else {
          WebviewManager.switchTo(account.id);
        }
      };

      const row = document.createElement("span");
      row.className = vertical
        ? "account-tab-icon-row flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center"
        : "account-tab-icon-row flex items-center justify-center";
      row.setAttribute("draggable", "false");

      const swatchWrap = document.createElement("span");
      swatchWrap.className = "relative shrink-0";
      const swatch = document.createElement("span");
      swatch.className =
        "account-tab-swatch flex shrink-0 items-center justify-center";
      swatch.style.backgroundColor = UI.getColor(account.id);

      const ic = document.createElement("span");
      ic.className =
        "iconify h-[1.0625rem] w-[1.0625rem] shrink-0 text-white drop-shadow-sm";
      ic.setAttribute("data-icon", rawIcon);
      swatch.appendChild(ic);
      swatchWrap.appendChild(swatch);

      if (unread > 0) {
        const chip = document.createElement("span");
        chip.className =
          "pointer-events-none absolute -right-1 -top-1 inline-flex min-h-[1.125rem] min-w-[1.125rem] shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[0.625rem] font-bold tabular-nums leading-none text-white shadow-sm ring-2 ring-white dark:ring-slate-950";
        chip.textContent = unread > 99 ? "99+" : String(unread);
        chip.title = t("ui.unreadAbbrev", { n: unread });
        chip.setAttribute("aria-hidden", "true");
        swatchWrap.appendChild(chip);
      }

      row.appendChild(swatchWrap);

      const tip = document.createElement("span");
      tip.className = `account-tab-tooltip account-tab-tooltip--${tipPlacement}`;
      tip.setAttribute("role", "tooltip");
      tip.dataset.placement = tipPlacement;

      const tipCaret = document.createElement("span");
      tipCaret.className = "account-tab-tooltip-caret";
      tipCaret.setAttribute("aria-hidden", "true");

      const tipLabel = document.createElement("span");
      tipLabel.className = "account-tab-tooltip-label";
      tipLabel.textContent = displayName;

      tip.appendChild(tipCaret);
      tip.appendChild(tipLabel);

      const showTip = () => {
        tip.style.opacity = "1";
        tip.style.visibility = "visible";
        layoutAccountTabTooltip(tab, tip, tipPlacement);
      };
      const hideTip = () => {
        tip.style.opacity = "0";
        tip.style.visibility = "hidden";
      };

      tip.style.opacity = "0";
      tip.style.visibility = "hidden";

      tab.appendChild(row);
      tab.appendChild(tip);

      tab.addEventListener("mouseenter", showTip);
      tab.addEventListener("mouseleave", hideTip);
      tab.addEventListener("focusin", showTip);
      tab.addEventListener("focusout", (ev) => {
        if (!tab.contains(ev.relatedTarget)) hideTip();
      });

      bar.appendChild(tab);
    });

    const repositionAccountTabTips = () => {
      bar.querySelectorAll(".account-tab-button").forEach((btn) => {
        const tip = btn.querySelector('[role="tooltip"]');
        if (
          !tip ||
          tip.style.visibility !== "visible" ||
          tip.style.opacity === "0"
        ) {
          return;
        }
        const placement =
          tip.dataset.placement === "below" ? "below" : "side";
        layoutAccountTabTooltip(btn, tip, placement);
      });
    };
    window.addEventListener("resize", repositionAccountTabTips);
    bar.addEventListener("scroll", repositionAccountTabTips, { passive: true });
    TopAccountBar._teardownViewportTips = () => {
      window.removeEventListener("resize", repositionAccountTabTips);
      bar.removeEventListener("scroll", repositionAccountTabTips);
    };

    this.styleSettingsBtn(settingsBtn, isDark, vertical);
  },
};

const SidebarUI = {
  render() {
    TopAccountBar.render();
  },
};

// Settings UI
const SettingsUI = {
  shellCard() {
    return `rounded-lg border ${UI.borderClass()} p-6 sm:p-7 ${UI.bgClass()}`;
  },

  show() {
    state.inSettingsMode = true;

    const mailWorkspace = document.getElementById("mail-workspace");
    const mainContent = document.getElementById("main-content");
    const settingsContent = document.getElementById("settings-content");
    if (mailWorkspace) mailWorkspace.style.display = "none";
    settingsContent.style.display = "flex";
    settingsContent.className =
      "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden";

    settingsContent.innerHTML = "";

    mainContent.className = "flex min-h-0 flex-1 flex-col overflow-hidden";

    const accSel =
      typeof state.settingsSidebarSelection === "number"
        ? AccountManager.get(state.settingsSidebarSelection)
        : null;
    if (
      state.settingsSidebarSelection == null ||
      (typeof state.settingsSidebarSelection === "number" && !accSel)
    ) {
      state.settingsSidebarSelection =
        state.accounts.length === 0 ? "add" : "general";
    }

    settingsContent.innerHTML = `
      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-5 py-6 pb-8 sm:px-8 sm:py-8 md:px-10 md:py-10 lg:px-12 lg:py-12">
        <div class="mx-auto flex w-full max-w-[76rem] flex-col gap-6 sm:gap-8">
          <h1 class="shrink-0 text-2xl font-semibold tracking-tight">${escapeHtml(t("settings.settingsTitle"))}</h1>
          <div class="flex min-h-0 min-w-0 w-full flex-row gap-x-6 sm:gap-x-8 md:gap-x-10 lg:gap-x-12 items-start">
            <aside class="w-64 shrink-0 sm:w-72 sticky top-4 self-start">
              <nav id="settings-sidebar-nav" class="rounded-lg border ${UI.borderClass()} ${UI.bgClass()} flex flex-col gap-3 p-3 sm:p-3.5" aria-label="${escapeAttr(t("settings.settingsTitle"))}"></nav>
            </aside>
            <div id="settings-detail-panel" class="min-h-0 min-w-0 flex-1 pl-0 sm:pl-1 max-h-[min(72vh,calc(100vh-11rem))] overflow-y-auto overscroll-y-contain"></div>
          </div>
        </div>
      </div>`;

    this.renderSettingsSidebar();
    this.renderDetail();
    TopAccountBar.render();
  },

  renderDetail() {
    const sel = state.settingsSidebarSelection;
    if (sel === "general") {
      this.mountGeneralPreferences();
    } else if (sel === "add") {
      this.showAddAccountForm();
    } else if (typeof sel === "number") {
      this.updatePanel(sel);
    }
  },

  renderSettingsSidebar() {
    const nav = document.getElementById("settings-sidebar-nav");
    if (!nav) return;

    nav.innerHTML = "";

    const selectedSurface = ThemeManager.isDark()
      ? "border-blue-400/65 bg-slate-900/60 ring-[3px] ring-inset ring-blue-400/25"
      : "border-blue-500/65 bg-blue-50/90 ring-[3px] ring-inset ring-blue-400/35";
    const idleSurface = ThemeManager.isDark()
      ? "border-transparent hover:border-slate-500/40"
      : "border-transparent hover:border-slate-300/95";
    const borderClass = UI.borderClass();
    const hoverClass = UI.hoverClass();

    const appendRow = (parent, selected, onClick, inner) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        `flex w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 ` +
        (ThemeManager.isDark()
          ? "focus-visible:ring-offset-slate-950"
          : "focus-visible:ring-offset-white") +
        ` ${borderClass} ` +
        (selected ? `${selectedSurface} ` : `${idleSurface} `) +
        hoverClass;
      btn.appendChild(inner);
      btn.addEventListener("click", onClick);
      parent.appendChild(btn);
    };

    appendRow(
      nav,
      state.settingsSidebarSelection === "general",
      () => {
        state.settingsSidebarSelection = "general";
        this.renderSettingsSidebar();
        this.renderDetail();
      },
      (() => {
        const wrap = document.createElement("span");
        wrap.className = "flex min-w-0 flex-1 items-center gap-3";
        const ic = document.createElement("span");
        ic.className =
          "iconify h-5 w-5 shrink-0 opacity-90";
        ic.setAttribute("data-icon", "mdi:tune-variant");
        const lab = document.createElement("span");
        lab.className = "min-w-0 truncate font-medium";
        lab.textContent = t("settings.generalSectionTitle");
        wrap.appendChild(ic);
        wrap.appendChild(lab);
        return wrap;
      })(),
    );

    const accountsSection = document.createElement("div");
    accountsSection.className =
      "flex min-w-0 flex-col gap-2 border-t pt-3 " + UI.dividerClass();

    const accountsHeading = document.createElement("div");
    accountsHeading.className =
      "flex items-center gap-2 px-0.5 " + UI.textMutedClass();
    const headingIcon = document.createElement("span");
    headingIcon.className =
      "iconify h-[1.125rem] w-[1.125rem] shrink-0 opacity-90";
    headingIcon.setAttribute("data-icon", "mdi:account-multiple-outline");
    const headingLabel = document.createElement("span");
    headingLabel.className =
      "text-[11px] font-semibold uppercase tracking-wide";
    headingLabel.textContent = t("settings.accounts");
    accountsHeading.appendChild(headingIcon);
    accountsHeading.appendChild(headingLabel);

    const accountsPanel = document.createElement("div");
    accountsPanel.className =
      `flex flex-col gap-1 rounded-lg border p-1.5 ${borderClass} ${UI.getThemeClass(
        "border-slate-600/50 bg-slate-950/35",
        "border-slate-200 bg-slate-100/90",
      )}`;

    state.accounts.forEach((account) => {
      const provider = getProviderInfo(account);
      if (!provider) return;

      const titleText = accountDisplayTitle(account, provider);
      const selected = state.settingsSidebarSelection === account.id;

      appendRow(
        accountsPanel,
        selected,
        () => {
          state.settingsSidebarSelection = account.id;
          this.renderSettingsSidebar();
          this.renderDetail();
        },
        (() => {
          const wrap = document.createElement("span");
          wrap.className = "flex min-w-0 flex-1 items-center gap-3";
          const iconWrap = document.createElement("span");
          iconWrap.className =
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-inner ring-[0.85px] ring-inset ring-white/40";
          iconWrap.style.backgroundColor = UI.getColor(account.id);
          const rawIcon =
            typeof provider.icon === "string" && provider.icon.trim().length > 0
              ? provider.icon.trim()
              : "mdi:email";
          const iconEl = document.createElement("span");
          iconEl.className =
            "iconify h-[1.15rem] w-[1.15rem] shrink-0 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,.2)]";
          iconEl.setAttribute("data-icon", rawIcon);
          iconWrap.appendChild(iconEl);
          const lab = document.createElement("span");
          lab.className = "min-w-0 truncate font-medium";
          lab.textContent = titleText;
          wrap.appendChild(iconWrap);
          wrap.appendChild(lab);
          return wrap;
        })(),
      );
    });

    appendRow(
      accountsPanel,
      state.settingsSidebarSelection === "add",
      () => {
        state.settingsSidebarSelection = "add";
        this.renderSettingsSidebar();
        this.renderDetail();
      },
      (() => {
        const wrap = document.createElement("span");
        wrap.className = "flex min-w-0 flex-1 items-center gap-3";
        const ic = document.createElement("span");
        ic.className = "iconify h-5 w-5 shrink-0";
        ic.setAttribute("data-icon", "mdi:plus-circle-outline");
        const lab = document.createElement("span");
        lab.className = "min-w-0 truncate font-medium";
        lab.textContent = t("settings.addAccountTitle");
        wrap.appendChild(ic);
        wrap.appendChild(lab);
        return wrap;
      })(),
    );

    accountsSection.appendChild(accountsHeading);
    accountsSection.appendChild(accountsPanel);
    nav.appendChild(accountsSection);
  },

  mountGeneralPreferences() {
    const mount = document.getElementById("settings-detail-panel");
    if (!mount) return;

    const api = window.electronAPI || {};
    if (!api.getUiLocalePreference || !api.getAppearancePreference) return;

    const inputBgClass = UI.inputBgClass();

    mount.innerHTML = `
      <section class="${SettingsUI.shellCard()} space-y-5" aria-labelledby="general-heading">
        <h2 id="general-heading" class="text-base font-semibold leading-tight">${escapeHtml(t("settings.generalSectionTitle"))}</h2>
        <div class="space-y-2">
          <label for="ui-locale-select" class="block text-xs font-medium ${UI.textMutedClass()}">${escapeHtml(t("settings.languageSection"))}</label>
          <select id="ui-locale-select" class="w-full rounded-md border px-3 py-2 text-sm transition-colors ${inputBgClass} focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50">
            <option value="system">${escapeHtml(t("settings.languageFollowSystem"))}</option>
            <option value="en">${escapeHtml(t("settings.languageEnglish"))}</option>
            <option value="de">${escapeHtml(t("settings.languageGerman"))}</option>
            <option value="fr">${escapeHtml(t("settings.languageFrench"))}</option>
            <option value="es">${escapeHtml(t("settings.languageSpanish"))}</option>
          </select>
          <p class="${UI.textMutedClass()} text-[11px] leading-relaxed">${escapeHtml(t("settings.languageAppliedHint"))}</p>
        </div>
        <div class="space-y-2 border-t pt-5 ${UI.getThemeClass("border-slate-600/65", "border-slate-200")}">
          <label for="ui-appearance-select" class="block text-xs font-medium ${UI.textMutedClass()}">${escapeHtml(t("settings.appearanceSection"))}</label>
          <select id="ui-appearance-select" class="w-full rounded-md border px-3 py-2 text-sm transition-colors ${inputBgClass} focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50">
            <option value="system">${escapeHtml(t("settings.appearanceFollowSystem"))}</option>
            <option value="light">${escapeHtml(t("settings.appearanceLight"))}</option>
            <option value="dark">${escapeHtml(t("settings.appearanceDark"))}</option>
          </select>
          <p class="${UI.textMutedClass()} text-[11px] leading-relaxed">${escapeHtml(t("settings.appearanceAppliedHint"))}</p>
        </div>
        <div class="space-y-2 border-t pt-5 ${UI.getThemeClass("border-slate-600/65", "border-slate-200")}">
          <label for="ui-tabbar-position-select" class="block text-xs font-medium ${UI.textMutedClass()}">${escapeHtml(t("settings.tabBarPositionSection"))}</label>
          <select id="ui-tabbar-position-select" class="w-full rounded-md border px-3 py-2 text-sm transition-colors ${inputBgClass} focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50">
            <option value="top">${escapeHtml(t("settings.tabBarTop"))}</option>
            <option value="side">${escapeHtml(t("settings.tabBarSide"))}</option>
          </select>
          <p class="${UI.textMutedClass()} text-[11px] leading-relaxed">${escapeHtml(t("settings.tabBarHint"))}</p>
        </div>
      </section>
    `;

    api.getUiLocalePreference().then((val) => {
      const sel = document.getElementById("ui-locale-select");
      if (!sel) return;

      sel.value = val === undefined || val === null ? "system" : val;

      sel.addEventListener("change", () => {
        api.setUiLocalePreference(sel.value).catch(() => {});
      });
    });

    api.getAppearancePreference().then((val) => {
      const sel = document.getElementById("ui-appearance-select");
      if (!sel) return;

      const mode =
        val === "light" || val === "dark" || val === "system" ? val : "system";
      sel.value = mode;

      sel.addEventListener("change", () => {
        const next = sel.value;
        api.setAppearancePreference(next).catch(() => {});
        ThemeManager.setAppearanceMode(next);
        ThemeManager.applyTheme();
        SidebarUI.render();
        if (state.inSettingsMode) {
          SettingsUI.show();
        }
      });
    });

    if (api.getTabBarPositionPreference && api.setTabBarPositionPreference) {
      api.getTabBarPositionPreference().then((val) => {
        const sel = document.getElementById("ui-tabbar-position-select");
        if (!sel) return;

        sel.value = val === "side" ? "side" : "top";

        sel.addEventListener("change", () => {
          const next = sel.value === "side" ? "side" : "top";
          api.setTabBarPositionPreference(next).catch(() => {});
          LayoutPrefs.setTabBarPosition(next);
          ThemeManager.applyTheme();
          SidebarUI.render();
          if (state.inSettingsMode) {
            SettingsUI.show();
          }
        });
      });
    }
  },

  showAddAccountForm() {
    const borderClass = UI.borderClass();
    const buttonClass = UI.buttonClass();

    const panel = document.getElementById("settings-detail-panel");
    if (!panel) return;
    panel.innerHTML = `
      <section class="${SettingsUI.shellCard()} space-y-5" aria-labelledby="add-account-title">
        <div class="flex items-center gap-3">
          <span class="iconify h-6 w-6 shrink-0 opacity-90" data-icon="mdi:inbox-multiple-outline"></span>
          <h2 id="add-account-title" class="text-base font-semibold leading-tight">${t("settings.addAccountTitle")}</h2>
        </div>
        <div class="space-y-2">
          ${Object.entries(PROVIDERS)
            .map(
              ([key, provider]) => `
            <button type="button" class="preset-btn group w-full rounded-lg border border-transparent px-4 py-3 text-left transition-colors ${buttonClass} flex items-center gap-3 focus-visible:outline focus-visible:ring-2 focus-visible:ring-blue-400/50" data-provider="${key}">
              <span class="iconify h-6 w-6 shrink-0 opacity-85 group-hover:opacity-100" data-icon="${provider.icon}"></span>
              <div class="min-w-0 flex-1">
                <p class="font-medium leading-snug">${escapeHtml(provider.name)}</p>
                <p class="${UI.textMutedClass()} truncate text-xs mt-0.5">${escapeHtml(provider.url)}</p>
              </div>
              <span class="iconify h-5 w-5 shrink-0 opacity-0 transition-opacity ${UI.textMutedClass()} group-hover:opacity-100" data-icon="mdi:chevron-right"></span>
            </button>
          `,
            )
            .join("")}

          <button type="button" class="preset-btn group w-full rounded-lg border border-dashed px-4 py-3 text-left transition-colors ${borderClass} ${UI.getThemeClass("border-slate-600 hover:bg-slate-700/65", "border-slate-300 hover:bg-slate-200/85")} flex items-center gap-3 focus-visible:outline focus-visible:ring-2 focus-visible:ring-blue-400/45" data-custom="true">
            <span class="iconify h-6 w-6 shrink-0 opacity-90" data-icon="mdi:pencil-plus-outline"></span>
            <div class="min-w-0 flex-1">
              <p class="font-medium leading-snug">${t("settings.customAccountCardTitle")}</p>
              <p class="${UI.textMutedClass()} text-xs mt-0.5">${t("settings.customAccountCardSubtitle")}</p>
            </div>
            <span class="iconify h-5 w-5 shrink-0 opacity-0 transition-opacity ${UI.textMutedClass()} group-hover:opacity-100" data-icon="mdi:chevron-right"></span>
          </button>
        </div>
      </section>
    `;

    // Preset buttons
    document.querySelectorAll(".preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.custom) {
          this.showCustomAccountForm();
        } else {
          const provider = btn.dataset.provider;
          const id = AccountManager.add(provider);
          const account = AccountManager.get(id);
          if (!account) return;

          WebviewManager.create(account);
          SidebarUI.render();
          state.settingsSidebarSelection = id;
          this.show();
        }
      });
    });
  },

  showCustomAccountForm() {
    const inputBgClass = UI.inputBgClass();
    const textMuted = UI.textMutedClass();
    const buttonClass = UI.buttonClass();

    const panel = document.getElementById("settings-detail-panel");
    if (!panel) return;
    panel.innerHTML = `
      <section class="${SettingsUI.shellCard()} space-y-6" aria-labelledby="custom-acc-title">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b pb-5 ${UI.dividerClass()}">
          <div class="flex min-w-0 items-center gap-3">
            <span class="iconify h-6 w-6 shrink-0 opacity-90" data-icon="mdi:pencil-plus-outline"></span>
            <h2 id="custom-acc-title" class="text-base font-semibold leading-tight">${t("settings.customAccountHeading")}</h2>
          </div>
          <button type="button" id="back-add-btn" class="shrink-0 rounded-lg px-4 py-2 text-sm transition-colors ${buttonClass}">
            ${t("settings.back")}
          </button>
        </div>

        <div class="space-y-5">
          <!-- Name -->
          <div class="space-y-2">
            <label class="block text-sm font-medium" for="custom-name">${t("settings.accountName")}</label>
            <input type="text" id="custom-name" placeholder="${t("settings.accountNamePlaceholder")}" class="w-full rounded-lg border px-3 py-2.5 text-sm shadow-sm ${inputBgClass} focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40">
          </div>

          <!-- URL -->
          <div class="space-y-2">
            <label class="block text-sm font-medium" for="custom-url">${t("settings.url")}</label>
            <input type="text" id="custom-url" placeholder="${t("settings.urlPlaceholder")}" class="w-full rounded-lg border px-3 py-2.5 text-sm shadow-sm ${inputBgClass} focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40">
          </div>

          <!-- Icon -->
          <div class="space-y-2">
            <label class="block text-sm font-medium" for="custom-icon">${t("settings.iconLabel")}</label>
            <input type="text" id="custom-icon" placeholder="mdi:email" class="w-full rounded-lg border px-3 py-2.5 text-sm shadow-sm ${inputBgClass} focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40">
            <p class="${textMuted} text-xs leading-relaxed">${t("settings.iconHint")}</p>
          </div>

          <!-- Color -->
          <div class="space-y-2">
            <label class="block text-sm font-medium" for="custom-color">${t("settings.color")}</label>
            <input type="color" id="custom-color" class="h-12 w-14 cursor-pointer overflow-hidden rounded-lg border ${UI.borderClass()}" value="#3b82f6">
          </div>
        </div>

        <!-- Primary action -->
        <div class="border-t pt-6 ${UI.dividerClass()}">
          <button type="button" id="create-account-btn" class="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700">
            ${t("settings.create")}
          </button>
        </div>
      </section>
    `;

    document
      .getElementById("create-account-btn")
      .addEventListener("click", () => {
        this.createCustomAccount();
      });

    document
      .getElementById("back-add-btn")
      ?.addEventListener("click", () => this.showAddAccountForm());
  },

  createCustomAccount() {
    const name = document.getElementById("custom-name").value.trim();
    const url = document.getElementById("custom-url").value.trim();
    const icon =
      document.getElementById("custom-icon").value.trim() || "mdi:email";
    const color = document.getElementById("custom-color").value;

    if (!name || !url) {
      alert(t("settings.missingNameOrUrlAlert"));
      return;
    }

    const id = AccountManager.addCustom({
      name,
      url,
      icon,
    });
    const account = AccountManager.get(id);
    if (!account) return;

    account.customColor = color;
    AccountManager.save();

    WebviewManager.create(account);
    WebviewManager.switchTo(id);

    this.hide();
  },

  hide() {
    state.inSettingsMode = false;

    const mailWorkspace = document.getElementById("mail-workspace");
    const settingsContent = document.getElementById("settings-content");
    settingsContent.style.display = "none";
    if (mailWorkspace) mailWorkspace.style.display = "flex";

    state.accounts.forEach((account) => {
      if (!state.webviews.has(account.id)) {
        WebviewManager.create(account);
      }
    });

    if (state.activeAccountId) {
      WebviewManager.switchTo(state.activeAccountId);
    }

    TopAccountBar.render();
  },

  updatePanel(accountId) {
    const account = AccountManager.get(accountId);
    const panelEl = document.getElementById("settings-detail-panel");
    if (!account) {
      if (panelEl) panelEl.innerHTML = "";
      return;
    }

    const inputBgClass = UI.inputBgClass();
    const textMuted = UI.textMutedClass();
    const buttonClass = UI.buttonClass();
    const deleteBtnTone = ThemeManager.isDark()
      ? "border border-red-500/35 bg-red-950/40 text-red-300 hover:bg-red-950/65"
      : "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100";

    const panel = panelEl;
    if (!panel) return;
    const provider = getProviderInfo(account);

    if (!provider) {
      panel.innerHTML = `
        <section class="${SettingsUI.shellCard()}" aria-live="polite">
          <p class="${textMuted} text-sm leading-relaxed">${t(
          "settings.unknownProvider",
          { id: account.id },
        )}</p>
        </section>`;
      return;
    }

    const defaultUrl =
      presetDefaultUrl(account.provider) || provider.url || "";

    // Convert HSL to hex for color picker
    const currentColor = account.customColor
      ? account.customColor
      : this.hslToHex(UI.getColor(accountId));

    const urlHintCopy = defaultUrl
      ? t("settings.customUrlHintWithUrl", { url: defaultUrl })
      : t("settings.customUrlHintNoUrl");

    const headerTitle = accountDisplayTitle(account, provider);
    const providerHint =
      account.customName?.trim() && provider.name !== headerTitle
        ? `<p class="${textMuted} mt-0.5 truncate text-xs">${escapeHtml(provider.name)}</p>`
        : "";

    panel.innerHTML = `
      <section class="${SettingsUI.shellCard()}" aria-labelledby="account-edit-heading">
        <div class="mb-6 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-center ${UI.dividerClass()}">
          <div id="settings-color-preview" class="mx-auto flex h-[4.75rem] w-[4.75rem] shrink-0 items-center justify-center rounded-2xl shadow-inner ring-1 ring-inset sm:mx-0 ${UI.borderClass()}"
            style="background-color: ${account.customColor || UI.getColor(accountId)}"></div>
          <div class="min-w-0 flex-1 text-center sm:text-left">
            <h2 id="account-edit-heading" class="truncate text-lg font-semibold tracking-tight">${escapeHtml(headerTitle)}</h2>
            ${providerHint}
            <p class="${textMuted} mt-1 font-mono text-xs tabular-nums">${t("ui.idPrefix")} ${account.id}</p>
          </div>
        </div>

        <div class="space-y-5">
          <div class="space-y-2">
            <label class="block text-sm font-medium" for="account-custom-name">${t("settings.customDisplayName")}</label>
            <input type="text" id="account-custom-name" placeholder="${escapeAttr(provider.name)}" value="${escapeAttr(account.customName || "")}"
              class="w-full rounded-lg border px-3 py-2.5 text-sm shadow-sm ${inputBgClass} focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40">
            <p class="${textMuted} text-xs leading-relaxed">${t("settings.customDisplayNameHint")}</p>
          </div>

          <div class="space-y-2">
            <label class="block text-sm font-medium" for="color-picker">${t("settings.color")}</label>
            <div class="flex flex-wrap items-center gap-3">
              <input type="color" id="color-picker" class="h-12 w-14 cursor-pointer overflow-hidden rounded-xl border shadow-sm ${UI.borderClass()}" value="${escapeAttr(currentColor)}">
              <button type="button" id="reset-color-btn" class="rounded-lg px-4 py-2 text-sm transition-colors ${buttonClass}">
                ${t("settings.resetColor")}
              </button>
            </div>
          </div>

          <div class="space-y-2">
            <label class="block text-sm font-medium" for="url-input">${t("settings.customUrl")}</label>
            <input type="text" id="url-input" placeholder="${escapeAttr(t("settings.customUrlPlaceholder"))}" value="${escapeAttr(account.customUrl || "")}"
              class="w-full rounded-lg border px-3 py-2.5 text-sm shadow-sm ${inputBgClass} focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40">
            <p class="${textMuted} text-xs leading-relaxed">${urlHintCopy}</p>
          </div>
        </div>

        <div class="mt-8 border-t pt-6 ${UI.dividerClass()}">
          <button type="button" id="delete-account-btn" class="w-full rounded-lg px-4 py-3 text-sm font-semibold shadow-sm transition-colors ${deleteBtnTone}">
            ${t("settings.deleteAccount")}
          </button>
        </div>
      </section>
    `;

    // Attach event listeners
    document
      .getElementById("account-custom-name")
      .addEventListener("change", (e) => {
        AccountManager.update(accountId, { customName: e.target.value });
        SidebarUI.render();
        this.renderSettingsSidebar();
      });

    document.getElementById("color-picker").addEventListener("change", (e) => {
      AccountManager.update(accountId, { customColor: e.target.value });
      document.getElementById("settings-color-preview").style.backgroundColor =
        e.target.value;
      SidebarUI.render();
      this.renderSettingsSidebar();
    });

    document.getElementById("url-input").addEventListener("change", (e) => {
      AccountManager.update(accountId, { customUrl: e.target.value });
      const updated = AccountManager.get(accountId);
      const webview = state.webviews.get(accountId);
      if (webview && updated) {
        webview.src = UI.getUrl(updated);
      }
    });

    document.getElementById("reset-color-btn").addEventListener("click", () => {
      AccountManager.update(accountId, { customColor: undefined });
      this.updatePanel(accountId);
      SidebarUI.render();
      this.renderSettingsSidebar();
    });

    document
      .getElementById("delete-account-btn")
      .addEventListener("click", () => {
        if (confirm(t("settings.confirmDelete"))) {
          if (AccountManager.delete(accountId)) {
            SidebarUI.render();
            state.settingsSidebarSelection = "general";
            this.show();
          }
        }
      });
  },

  hslToHex(hsl) {
    const match = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!match) return "#808080";

    const h = parseInt(match[1]) / 360;
    const s = parseInt(match[2]) / 100;
    const l = parseInt(match[3]) / 100;

    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    const toHex = (x) => {
      const hex = Math.round(x * 255).toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    };

    return "#" + toHex(r) + toHex(g) + toHex(b);
  },
};

// Initialize
document.addEventListener("DOMContentLoaded", async () => {
  document.documentElement.lang =
    window.electronAPI.locale || document.documentElement.lang || "en";

  let appearance = "system";
  if (window.electronAPI?.getAppearancePreference) {
    try {
      appearance = await window.electronAPI.getAppearancePreference();
    } catch {
      appearance = "system";
    }
  }
  ThemeManager.setAppearanceMode(appearance);

  let tabBarPos = "top";
  if (window.electronAPI?.getTabBarPositionPreference) {
    try {
      tabBarPos = await window.electronAPI.getTabBarPositionPreference();
    } catch {
      tabBarPos = "top";
    }
  }
  LayoutPrefs.setTabBarPosition(tabBarPos);

  ThemeManager.init();

  // Settings button
  document.getElementById("settings-btn").addEventListener("click", () => {
    if (state.inSettingsMode) {
      SettingsUI.hide();
    } else {
      SettingsUI.show();
    }
  });

  // Close menu on outside click
  document.addEventListener("click", (e) => {
    const menu = document.getElementById("provider-menu");
    if (menu && !menu.contains(e.target)) {
      menu.style.display = "none";
    }
  });

  // Initialize webviews
  state.accounts.forEach((account) => {
    WebviewManager.create(account);
  });

  SidebarUI.render();
  UnreadCountManager.sendTotalCount();
  SettingsUI.hide();

  if (state.accounts.length == 0) {
    SettingsUI.show();
  } else {
    WebviewManager.switchTo(state.activeAccountId || state.accounts[0].id);
  }
});
