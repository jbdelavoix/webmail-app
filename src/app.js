const PROVIDERS = {
  gmail: {
    name: "Gmail",
    url: "https://mail.google.com",
    icon: "simple-icons:gmail",
  },
  outlook: {
    name: "Outlook",
    url: "https://outlook.live.com",
    icon: "simple-icons:microsoftoutlook",
  },
  icloud: {
    name: "iCloud Mail",
    url: "https://mail.icloud.com",
    icon: "simple-icons:icloud",
  },
  yahoo: {
    name: "Yahoo Mail",
    url: "https://mail.yahoo.com",
    icon: "simple-icons:yahoo",
  },
};

// State management
const state = {
  accounts: JSON.parse(localStorage.getItem("accounts") || "[]"),
  activeAccountId: localStorage.getItem("activeAccountId") || null,
  activeSettingsAccountId: null,
  inSettingsMode: false,
  webviews: new Map(),
};

// Theme management (based on system preference)
const ThemeManager = {
  isDark() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  },

  init() {
    this.applyTheme();
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        this.applyTheme();
        if (document.getElementById("account-settings-panel")?.innerHTML) {
          SettingsUI.show();
        }
      });
  },

  applyTheme() {
    const isDark = this.isDark();
    const html = document.documentElement;

    if (isDark) {
      html.classList.remove("bg-white", "text-slate-900");
      html.classList.add("bg-slate-900", "text-slate-100");
      document.body.className = "h-screen bg-slate-900 text-slate-100";
      document.querySelector("aside").className =
        "w-20 bg-slate-950 border-slate-800 border-r flex flex-col items-center py-4 gap-4";
    } else {
      html.classList.remove("bg-slate-900", "text-slate-100");
      html.classList.add("bg-white", "text-slate-900");
      document.body.className = "h-screen bg-white text-slate-900";
      document.querySelector("aside").className =
        "w-20 bg-slate-50 border-slate-300 border-r flex flex-col items-center py-4 gap-4";
    }
  },
};

// Account management
const AccountManager = {
  save() {
    localStorage.setItem("accounts", JSON.stringify(state.accounts));
    localStorage.setItem("activeAccountId", state.activeAccountId);
  },

  add(providerKey) {
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
    return true;
  },

  update(accountId, changes) {
    const account = state.accounts.find((a) => a.id == accountId);
    if (account) {
      Object.assign(account, changes);
      this.save();
    }
  },

  get(accountId) {
    if (!accountId) return null;
    return state.accounts.find((a) => a.id == accountId);
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
    return account.customUrl || PROVIDERS[account.provider].url;
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
};

// Webview management
const WebviewManager = {
  create(account) {
    const mainContent = document.getElementById("main-content");
    const webview = document.createElement("webview");
    webview.id = `webview-${account.id}`;
    webview.className = "w-full h-full";
    webview.src = UI.getUrl(account);
    webview.partition = account.partition;
    webview.style.display =
      state.activeAccountId == account.id ? "flex" : "none";

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
};

// Sidebar UI
const SidebarUI = {
  render() {
    const list = document.getElementById("accounts-list");
    list.innerHTML = "";

    const isDark = ThemeManager.isDark();

    state.accounts.forEach((account) => {
      const provider = PROVIDERS[account.provider];
      const isActive = account.id == state.activeAccountId;
      const displayName = account.customName || provider.name;

      const accountEl = document.createElement("div");
      accountEl.className = "relative w-10 h-10 group";

      const button = document.createElement("button");
      button.className = `w-10 h-10 p-2 rounded-xl flex items-center justify-center transition-all duration-200 ${
        isDark ? "hover:brightness-125" : "hover:brightness-90"
      }`;
      button.title = displayName;
      button.setAttribute("data-account-name", displayName);
      button.onclick = () => {
        if (state.inSettingsMode) {
          state.activeAccountId = account.id;
          AccountManager.save();
          SettingsUI.hide();
        } else {
          WebviewManager.switchTo(account.id);
        }
      };

      button.style.backgroundColor = UI.getColor(account.id);
      button.style.opacity = isActive ? "1" : "0.5";
      button.style.border = isDark ? "" : "1px solid rgba(0,0,0,0.1)";

      button.addEventListener("mouseenter", () => {
        button.style.opacity = isActive ? "1" : "0.7";
        button.style.filter = isDark ? "brightness(1.2)" : "brightness(0.9)";
      });
      button.addEventListener("mouseleave", () => {
        button.style.opacity = isActive ? "1" : "0.5";
        button.style.filter = "brightness(1)";
      });

      const icon = document.createElement("span");
      icon.className = "iconify w-6 h-6";
      icon.setAttribute("data-icon", provider.icon);
      button.appendChild(icon);

      if (account.unreadCount > 0) {
        const badge = document.createElement("span");
        badge.className =
          "absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold";
        badge.textContent = account.unreadCount;
        accountEl.appendChild(badge);
      }

      // Add tooltip
      const tooltip = document.createElement("div");
      tooltip.className =
        "absolute left-14 top-1/2 transform -translate-y-1/2 bg-slate-900 text-white px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50";
      tooltip.textContent = displayName;
      accountEl.appendChild(tooltip);

      accountEl.appendChild(button);
      list.appendChild(accountEl);
    });
  },
};

// Settings UI
const SettingsUI = {
  show() {
    state.inSettingsMode = true;

    const mainContent = document.getElementById("main-content");
    const settingsContent = document.getElementById("settings-content");
    mainContent.style.display = "none";
    settingsContent.style.display = "flex";
    settingsContent.innerHTML = "";

    const bgClass = UI.bgClass();
    const borderClass = UI.borderClass();

    mainContent.className = "flex-1 flex overflow-hidden";

    html =
      state.accounts.length !== 0
        ? `
      <div class="w-48 ${bgClass} border-r ${borderClass} overflow-y-auto p-4 flex flex-col">
        <div class="flex-1">
          <h3 class="font-semibold mb-4">Comptes</h3>
          <div id="accounts-settings-list" class="space-y-2"></div>
        </div>
        <button id="add-account-settings-btn" class="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors flex items-center justify-center gap-2">
          <span class="iconify w-5 h-5" data-icon="mdi:plus"></span>
          Ajouter
        </button>
      </div>
      `
        : "";
    html += `
      <div class="flex-1 overflow-y-auto p-8">
        <div class="max-w-2xl">
          <div id="account-settings-panel" class="space-y-6"></div>
        </div>
      </div>
    `;
    settingsContent.innerHTML = html;

    if (state.accounts.length !== 0) {
      this.renderAccountsList();
      this.updatePanel(state.activeSettingsAccountId);

      document
        .getElementById("add-account-settings-btn")
        .addEventListener("click", () => {
          this.showAddAccountForm();
        });
    } else {
      this.showAddAccountForm();
    }
  },

  showAddAccountForm() {
    const bgClass = UI.bgClass();
    const hoverClass = UI.hoverClass();
    const inputBgClass = UI.inputBgClass();
    const textMuted = UI.textMutedClass();
    const buttonClass = UI.buttonClass();

    const panel = document.getElementById("account-settings-panel");
    panel.innerHTML = `
      <div>
        <h2 class="text-2xl font-bold mb-6">Ajouter un compte</h2>

        <div class="space-y-3">
          ${Object.entries(PROVIDERS)
            .filter(([key]) => !key.startsWith("custom"))
            .map(
              ([key, provider]) => `
            <button class="preset-btn w-full px-4 py-3 text-left rounded-lg transition-colors ${buttonClass} flex items-center gap-3" data-provider="${key}">
              <span class="iconify w-5 h-5" data-icon="${provider.icon}"></span>
              <div>
                <p class="font-medium">${provider.name}</p>
                <p class="text-xs opacity-75">${provider.url}</p>
              </div>
            </button>
          `,
            )
            .join("")}

          <button class="preset-btn w-full px-4 py-3 text-left rounded-lg transition-colors ${buttonClass} flex items-center gap-3" data-custom="true">
            <span class="iconify w-5 h-5" data-icon="mdi:plus-circle"></span>
            <div>
              <p class="font-medium">Compte personnalisé</p>
              <p class="text-xs opacity-75">Ajouter votre propre compte</p>
            </div>
          </button>
        </div>
      </div>
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
          WebviewManager.create(account);
          SidebarUI.render();
          state.activeSettingsAccountId = id;
          this.show();
        }
      });
    });
  },

  showCustomAccountForm() {
    const bgClass = UI.bgClass();
    const inputBgClass = UI.inputBgClass();
    const textMuted = UI.textMutedClass();

    const panel = document.getElementById("account-settings-panel");
    panel.innerHTML = `
      <div>
        <h2 class="text-2xl font-bold mb-6">Compte personnalisé</h2>

        <div class="space-y-6">
          <!-- Name -->
          <div>
            <label class="block font-medium mb-2">Nom du compte</label>
            <input type="text" id="custom-name" placeholder="Mon compte mail" class="w-full px-3 py-2 ${inputBgClass} rounded border text-sm focus:outline-none focus:border-blue-500">
          </div>

          <!-- URL -->
          <div>
            <label class="block font-medium mb-2">URL</label>
            <input type="text" id="custom-url" placeholder="https://..." class="w-full px-3 py-2 ${inputBgClass} rounded border text-sm focus:outline-none focus:border-blue-500">
          </div>

          <!-- Icon -->
          <div>
            <label class="block font-medium mb-2">Icône (code Iconify)</label>
            <input type="text" id="custom-icon" placeholder="mdi:email" class="w-full px-3 py-2 ${inputBgClass} rounded border text-sm focus:outline-none focus:border-blue-500">
            <p class="${textMuted} text-xs mt-2">Ex: mdi:email, simple-icons:gmail, mdi:account...</p>
          </div>

          <!-- Color -->
          <div>
            <label class="block font-medium mb-2">Couleur</label>
            <input type="color" id="custom-color" class="w-12 h-12 rounded cursor-pointer" value="#3b82f6">
          </div>

          <!-- Buttons -->
          <div class="flex gap-2 pt-4">
            <button id="create-account-btn" class="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors">
              Créer
            </button>
            <button id="back-add-btn" class="px-4 py-2 ${UI.buttonClass()} rounded text-sm transition-colors">
              Retour
            </button>
          </div>
        </div>
      </div>
    `;

    document
      .getElementById("create-account-btn")
      .addEventListener("click", () => {
        this.createCustomAccount();
      });

    document.getElementById("back-add-btn").addEventListener("click", () => {
      this.showAddAccountForm();
    });
  },

  createCustomAccount() {
    const name = document.getElementById("custom-name").value.trim();
    const url = document.getElementById("custom-url").value.trim();
    const icon =
      document.getElementById("custom-icon").value.trim() || "mdi:email";
    const color = document.getElementById("custom-color").value;

    if (!name || !url) {
      alert("Veuillez remplir le nom et l'URL");
      return;
    }

    const providerKey = `custom-${Date.now()}`;
    PROVIDERS[providerKey] = { name, url, icon };

    const id = AccountManager.add(providerKey);
    const account = AccountManager.get(id);
    if (account) {
      account.customColor = color;
      AccountManager.save();
    }

    WebviewManager.create(account);
    WebviewManager.switchTo(id);

    this.hide();
  },

  hide() {
    state.inSettingsMode = false;

    const mainContent = document.getElementById("main-content");
    const settingsContent = document.getElementById("settings-content");
    settingsContent.style.display = "none";
    mainContent.style.display = "flex";

    state.accounts.forEach((account) => {
      if (!state.webviews.has(account.id)) {
        WebviewManager.create(account);
      }
    });

    if (state.activeAccountId) {
      WebviewManager.switchTo(state.activeAccountId);
    }
  },

  renderAccountsList() {
    const list = document.getElementById("accounts-settings-list");
    list.innerHTML = "";

    const hoverClass = UI.hoverClass();
    const bgClass = UI.bgClass();

    state.accounts.forEach((account) => {
      const provider = PROVIDERS[account.provider];
      const isSelected = account.id == state.activeSettingsAccountId;

      const item = document.createElement("button");
      item.className = `w-full px-3 py-3 text-left rounded transition-colors text-sm ${hoverClass} ${isSelected ? bgClass : ""}`;

      // Use inline style for border
      let borderStyle = "2px solid transparent";
      let paddingLeft = "13px";

      if (isSelected) {
        borderStyle = `4px solid ${UI.getColor(account.id)}`;
        paddingLeft = "11px";
      }

      item.style.borderLeft = borderStyle;
      item.style.paddingLeft = paddingLeft;

      item.innerHTML = `
        <p class="font-medium">${provider.name}</p>
        <p class="${UI.textMutedClass()} text-xs truncate">#${account.id}</p>
      `;

      item.onclick = () => {
        state.activeSettingsAccountId = account.id;
        this.renderAccountsList();
        this.updatePanel(account.id);
      };

      list.appendChild(item);
    });
  },

  updatePanel(accountId) {
    const account = AccountManager.get(accountId);
    if (!account) {
      document.getElementById("account-settings-panel").innerHTML = "";
      return;
    }

    const bgClass = UI.bgClass();
    const inputBgClass = UI.inputBgClass();
    const textMuted = UI.textMutedClass();
    const buttonClass = UI.buttonClass();

    const panel = document.getElementById("account-settings-panel");
    const provider = PROVIDERS[account.provider];

    // Convert HSL to hex for color picker
    const currentColor = account.customColor
      ? account.customColor
      : this.hslToHex(UI.getColor(accountId));

    panel.innerHTML = `
      <div>
        <h2 class="text-2xl font-bold mb-4">Paramètres</h2>

        <div class="flex items-center gap-4 p-4 ${bgClass} rounded-lg mb-6">
          <div id="settings-color-preview" class="w-16 h-16 rounded-lg flex-shrink-0" style="background-color: ${account.customColor || UI.getColor(accountId)}"></div>
          <div class="flex-1">
            <p class="font-semibold">${provider.name}</p>
            <p class="${textMuted} text-sm">ID: ${account.id}</p>
          </div>
        </div>

        <div class="space-y-6">
          <!-- Custom Name -->
          <div>
            <label class="block font-medium mb-2">Nom personnalisé</label>
            <input type="text" id="account-custom-name" placeholder="${provider.name}" value="${account.customName || ""}"
              class="w-full px-3 py-2 ${inputBgClass} rounded border text-sm focus:outline-none focus:border-blue-500">
            <p class="${textMuted} text-xs mt-2">Laissez vide pour utiliser le nom par défaut</p>
          </div>

          <!-- Color -->
          <div>
            <label class="block font-medium mb-2">Couleur</label>
            <div class="flex gap-3">
              <input type="color" id="color-picker" class="w-12 h-12 rounded cursor-pointer" value="${currentColor}">
              <button id="reset-color-btn" class="px-4 py-2 ${buttonClass} rounded transition-colors text-sm">
                Réinitialiser
              </button>
            </div>
          </div>

          <!-- URL -->
          <div>
            <label class="block font-medium mb-2">URL personnalisée</label>
            <input type="text" id="url-input" placeholder="https://..." value="${account.customUrl || ""}"
              class="w-full px-3 py-2 ${inputBgClass} rounded border text-sm focus:outline-none focus:border-blue-500">
            <p class="${textMuted} text-xs mt-2">Laissez vide pour l'URL par défaut: ${PROVIDERS[account.provider].url}</p>
          </div>

          <!-- Delete -->
          <button id="delete-account-btn" class="w-full px-4 py-2 ${buttonClass} rounded text-sm font-medium transition-colors text-red-600 hover:bg-red-100 dark:hover:bg-red-900/20">
            Supprimer ce compte
          </button>
        </div>
      </div>
    `;

    // Attach event listeners
    document
      .getElementById("account-custom-name")
      .addEventListener("change", (e) => {
        AccountManager.update(accountId, { customName: e.target.value });
        SidebarUI.render();
        this.renderAccountsList();
      });

    document.getElementById("color-picker").addEventListener("change", (e) => {
      AccountManager.update(accountId, { customColor: e.target.value });
      document.getElementById("settings-color-preview").style.backgroundColor =
        e.target.value;
      SidebarUI.render();
      this.renderAccountsList();
    });

    document.getElementById("url-input").addEventListener("change", (e) => {
      AccountManager.update(accountId, { customUrl: e.target.value });
      const webview = state.webviews.get(accountId);
      if (webview && e.target.value) {
        webview.src = e.target.value;
      }
    });

    document.getElementById("reset-color-btn").addEventListener("click", () => {
      AccountManager.update(accountId, { customColor: undefined });
      this.updatePanel(accountId);
      SidebarUI.render();
      this.renderAccountsList();
    });

    document
      .getElementById("delete-account-btn")
      .addEventListener("click", () => {
        if (confirm("Êtes-vous sûr de vouloir supprimer ce compte ?")) {
          if (AccountManager.delete(accountId)) {
            SidebarUI.render();
            state.activeSettingsAccountId = null;
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
document.addEventListener("DOMContentLoaded", () => {
  ThemeManager.init();

  // Settings button
  document.getElementById("settings-btn").addEventListener("click", () => {
    if (!state.inSettingsMode && state.accounts.length) {
      SettingsUI.show();
    } else {
      SettingsUI.hide();
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
  SettingsUI.hide();

  if (state.accounts.length == 0) {
    SettingsUI.show();
  } else {
    WebviewManager.switchTo(state.activeAccountId || state.accounts[0].id);
  }
});
