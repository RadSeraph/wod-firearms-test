// ==========================================
// МОДУЛЬ: WoD Firearms (Test)
// Файл: scripts/main.js
// ==========================================

const MODULE_ID = "wod-firearms-test";

// Конфигурация режимов стрельбы
const FIRE_MODES = {
    single: { label: "Одиночный", cost: 1, bonus: 0, diffMod: 0, isBurst: false },
    short:  { label: "Короткая очередь", cost: 3, bonus: 2, diffMod: 1, isBurst: true },
    long:   { label: "Длинная очередь", cost: "ALL", bonus: 10, diffMod: 2, isBurst: true }
};

// ==========================================
// 1. РАДИАЛЬНОЕ МЕНЮ
// ==========================================
Hooks.on("ready", () => {
    if (document.getElementById("wod-firearms-menu")) return;

    const container = document.createElement("div");
    container.id = "wod-firearms-menu";
    container.style.cssText = "position: fixed; top: 55%; left: 50px; width: 50px; height: 50px; z-index: 10; pointer-events: none;";

    const btn = document.createElement("div");
    btn.innerHTML = `<i class="fas fa-crosshairs"></i>`;
    btn.title = "Стрельба (Тест)";
    btn.style.cssText = `
        width: 45px; height: 45px; background: #8b0000; color: white;
        border-radius: 50%; display: flex; align-items: center; justify-content: center;
        font-size: 20px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.6);
        border: 2px solid #ff4444; transition: all 0.2s ease;
        z-index: 2; pointer-events: auto;
    `;
    btn.onmouseenter = () => { btn.style.transform = "scale(1.2)"; btn.style.background = "#a80000"; };
    btn.onmouseleave = () => { btn.style.transform = "scale(1)"; btn.style.background = "#8b0000"; };
    
    btn.addEventListener("click", () => openFirearmsPanel());

    container.appendChild(btn);
    document.body.appendChild(container);
});

// ==========================================
// 2. ПАНЕЛЬ СТРЕЛЬБЫ
// ==========================================
async function openFirearmsPanel() {
    const isGM = game.user.isGM;
    const template = await renderTemplate(`modules/${MODULE_ID}/templates/panel.html`, {});
    
    new Dialog({
        title: "Стрельба (Тест)",
        content: template,
        buttons: { close: { label: "Закрыть" } },
        render: (html) => setupFirearmsLogic(html, isGM)
    }, { width: 400, height: 520, resizable: true }).render(true);
}

function setupFirearmsLogic(html, isGM) {
    if (isGM) {
        let npcOptions = `<option value="">Не выбрано</option>`;
        game.actors.filter(a => a.type === "Vampire" || a.type === "Mortal").sort((a,b) => a.name.localeCompare(b.name)).forEach(n => {
            npcOptions += `<option value="${n.id}">${n.name}</option>`;
        });
        html.find('#firearms-npc-select').html(npcOptions);
        html.find('#firearms-npc-block').show();
        html.find('#firearms-actor-block').hide();
    } else {
        const actor = game.user.character;
        if (actor) {
            html.find('#firearms-actor-select').html(`<option value="${actor.id}">${actor.name}</option>`);
            html.find('#firearms-actor-block').hide();
        }
    }

    const updateWeapons = () => {
        const actorId = isGM ? html.find('#firearms-npc-select').val() : game.user.character?.id;
        const actor = game.actors.get(actorId);
        if (!actor) return;

        const weapons = actor.items.filter(i => i.type === "Ranged Weapon");
        let options = `<option value="">Не выбрано</option>`;
        weapons.forEach(w => options += `<option value="${w.id}">${w.name}</option>`);
        html.find('#firearms-weapon-select').html(options);
        updateAmmoInfo(actor, null);
    };

    const updateAmmoInfo = (actor, weapon) => {
        if (!weapon) return html.find('#firearms-ammo-info').text("В магазине: 0 / 0");
        const clip = weapon.system.clip || { value: 0, max: 0 };
        html.find('#firearms-ammo-info').text(`В магазине: ${clip.value} / ${clip.max}`);
    };

    if (isGM) html.find('#firearms-npc-select').change(updateWeapons);
    html.find('#firearms-weapon-select').change(function() {
        const actorId = isGM ? html.find('#firearms-npc-select').val() : game.user.character?.id;
        const actor = game.actors.get(actorId);
        updateAmmoInfo(actor, actor?.items.get($(this).val()));
    });

    html.find('#firearms-fire-btn').click(async () => {
        const actorId = isGM ? html.find('#firearms-npc-select').val() : game.user.character?.id;
        const actor = game.actors.get(actorId);
        if (!actor) return ui.notifications.error("Выберите персонажа!");

        const weaponId = html.find('#firearms-weapon-select').val();
        const weapon = actor.items.get(weaponId);
        if (!weapon) return ui.notifications.error("Выберите оружие!");

        const mode = html.find('#firearms-mode-select').val();
        const isVampire = html.find('#firearms-is-vampire').is(':checked');

        openAttackRollDialog(actor, weapon, mode, isVampire, html);
    });

    updateWeapons();
}

// ==========================================
// 3. ОКНО БРОСКА И ЛОГИКА
// ==========================================
async function openAttackRollDialog(actor, weapon, mode, isVampire, panelHtml) {
    const config = FIRE_MODES[mode];
    const clip = weapon.system.clip;
    
    // Проверка патронов
    if (mode === "long") {
        if (clip.value <= clip.max / 2) return ui.notifications.error(`Слишком мало патронов для длинной очереди!`);
    } else if (clip.value < config.cost) {
        return ui.notifications.error(`Недостаточно патронов! (Нужно ${config.cost}, в магазине ${clip.value})`);
    }

    // Расчет пула атаки
    const attrKey = weapon.system.attack.attribute || "dexterity";
    const abilityKey = weapon.system.attack.ability || "firearms";
    const attrVal = actor.system.attributes[attrKey]?.total || 0;
    const abilityVal = actor.system.abilities[abilityKey]?.value || 0;
    const accuracy = weapon.system.attack.accuracy || 0;
    const specialty = actor.system.abilities[abilityKey]?.speciality || "";

    let basePool = attrVal + abilityVal + accuracy + config.bonus;
    const finalDiff = parseInt(weapon.system.difficulty || 6) + config.diffMod;

    const dialogContent = `
        <div style="font-family: 'Signika', sans-serif; padding: 5px;">
            <h3 style="margin-top: 0; color: #8b0000; border-bottom: 1px solid #ccc; padding-bottom: 5px;">Roll attack ${weapon.name}</h3>
            <p><strong>Dice pool:</strong> ${attrKey} (${attrVal}) + ${abilityKey} (${abilityVal}) ${accuracy ? `+ Acc (${accuracy})` : ''} ${config.bonus ? `+ Mode Bonus (${config.bonus})` : ''} = <strong>${basePool}d10</strong></p>
            <p><strong>Difficulty:</strong> ${finalDiff}</p>
            ${specialty ? `<p><strong>Speciality:</strong> ${specialty} (10s count as 2 successes)</p>` : ''}
            <div style="margin-top: 10px; padding: 5px; background: rgba(0,0,0,0.05); border-radius: 4px;">
                <label style="display: flex; align-items: center; cursor: pointer; margin: 0; font-size: 0.9em;">
                    <input type="checkbox" id="use-willpower-attack" style="margin-right: 8px;">
                    <span>Use Willpower (+1 auto-success, -1 WP)</span>
                </label>
            </div>
            <div style="display: flex; gap: 10px; justify-content: center; margin-top: 15px;">
                <button type="button" class="wod-roll-btn" style="background: #8b0000; color: white; padding: 5px 15px; border: 1px solid #5c0000; cursor: pointer; font-weight: bold;">Roll</button>
                <button type="button" class="wod-cancel-btn" style="background: #444; color: white; padding: 5px 15px; border: 1px solid #222; cursor: pointer; font-weight: bold;">Cancel</button>
            </div>
        </div>
    `;

    new Dialog({
        title: `Roll attack ${weapon.name}`,
        content: dialogContent,
        buttons: {},
        render: (html) => {
            html.find('.wod-cancel-btn').click(() => html.closest('.dialog').find('.header-button.close').click());
            html.find('.wod-roll-btn').click(async () => {
                const useWillpower = html.find('#use-willpower-attack').is(':checked');
                html.closest('.dialog').find('.header-button.close').click();
                
                // Списание патронов
                let newClipValue = clip.value - (config.cost === "ALL" ? clip.value : config.cost);
                await weapon.update({ "system.clip.value": newClipValue });
                if (panelHtml) {
                    panelHtml.find('#firearms-ammo-info').text(`В магазине: ${newClipValue} / ${clip.max}`);
                }

                // Бросок атаки
                const roll = new Roll(`${basePool}d10`);
                await roll.evaluate();
                if (game.dice3d) await game.dice3d.showForRoll(roll, game.user, true, null, false);

                let rawSuccesses = 0, ones = 0, diceHTML = "";
                
                for (let die of roll.dice[0].results) {
                    let isSuccess = die.result >= finalDiff;
                    let isOne = die.result === 1;
                    let isSpec = (die.result === 10 && specialty);
                    
                    if (isSuccess) rawSuccesses += isSpec ? 2 : 1;
                    if (isOne) ones++;
                    
                    let color = isSuccess ? (isSpec ? "#f1c40f" : "#2ecc71") : (isOne ? "#e74c3c" : "#7f8c8d");
                    diceHTML += `<span style="display:inline-block; width:24px; height:24px; background:${color}; color:white; border-radius:50%; text-align:center; line-height:24px; margin:2px; font-weight:bold;">${die.result}</span>`;
                }

                let netSuccesses = Math.max(0, rawSuccesses - ones);
                let attackResultHTML = "";
                
                if (rawSuccesses === 0 && ones > 0) {
                    attackResultHTML = `<div style="color: #d32f2f; font-weight: bold; margin-top: 5px;">ПРОВАЛ (Ботч)</div>`;
                } else if (netSuccesses === 0) {
                    attackResultHTML = `<div style="color: #7f8c8d; font-weight: bold; margin-top: 5px;">ПРОМАХ</div>`;
                } else {
                    attackResultHTML = `<div style="color: #2e6b4e; font-weight: bold; margin-top: 5px;">Успехи: ${netSuccesses}${useWillpower ? ' (+1 от Воли)' : ''}</div>`;
                }

                if (useWillpower) {
                    netSuccesses += 1;
                    const curWP = actor.system.advantages.willpower.temporary;
                    await actor.update({ "system.advantages.willpower.temporary": Math.max(0, curWP - 1) });
                }

                // Отправка карточки атаки
                const attackHtml = await renderTemplate(`modules/${MODULE_ID}/templates/chat-attack.html`, {
                    actorName: actor.name,
                    weaponName: weapon.name,
                    pool: `${basePool}d10`,
                    difficulty: finalDiff,
                    successes: netSuccesses,
                    diceHTML: diceHTML + attackResultHTML
                });

                await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: actor }), content: attackHtml });

                // Логика урона (если есть успехи)
                if (netSuccesses > 0) {
                    const baseDamage = weapon.system.damage.bonus || 0;
                    // Успехи после первого (т.е. netSuccesses - 1). Минимум 1 успех для урона, если атака попала.
                    const damageDice = Math.max(1, baseDamage + netSuccesses - 1); 
                    
                    let damageType = weapon.system.damage.type || "lethal";
                    if (isVampire && damageType === "lethal") damageType = "bashing";

                    const dmgRoll = new Roll(`${damageDice}d10`);
                    await dmgRoll.evaluate();
                    if (game.dice3d) await game.dice3d.showForRoll(dmgRoll, game.user, true, null, false);

                    // На урон нет ботчей, минимум 1 успех
                    let dmgSuccesses = 0;
                    let dmgDiceHTML = "";
                    for (let die of dmgRoll.dice[0].results) {
                        let isSuccess = die.result >= 6;
                        if (isSuccess) dmgSuccesses++;
                        let color = isSuccess ? "#2ecc71" : "#7f8c8d";
                        dmgDiceHTML += `<span style="display:inline-block; width:24px; height:24px; background:${color}; color:white; border-radius:50%; text-align:center; line-height:24px; margin:2px; font-weight:bold;">${die.result}</span>`;
                    }
                    
                    dmgSuccesses = Math.max(1, dmgSuccesses); // Минимум 1

                    const damageHtml = await renderTemplate(`modules/${MODULE_ID}/templates/chat-damage.html`, {
                        actorName: actor.name,
                        weaponName: weapon.name,
                        pool: `${baseDamage} + ${netSuccesses - 1} (${damageType})`,
                        difficulty: 6,
                        successes: dmgSuccesses,
                        diceHTML: dmgDiceHTML
                    });

                    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: actor }), content: damageHtml });
                }
            });
        }
    }, { width: 400, height: 320, resizable: false }).render(true);
}
