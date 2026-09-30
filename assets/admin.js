/**
 * Forms to Odoo: mapping UI of the "Odoo" tab in the Contact Form 7 editor.
 * State lives in the hidden #fto-settings input (JSON), saved with the form.
 */
(function () {
	const root = document.getElementById("fto-app");
	const store = document.getElementById("fto-settings");
	if (!root || !store || !window.ftoAdmin) return;

	const { ajaxUrl, nonce, configured, models, tags, textTypes, i18n, formId, choices } = window.ftoAdmin;
	const MULTILINE = ["text", "html"];

	const state = Object.assign({ enabled: false, model: "crm.lead", mapping: [] }, JSON.parse(store.value || "{}"));
	let fields = null; // Odoo fields of state.model, null while unknown
	let fieldsError = "";
	const records = {}; // relation model => [{id, name}] | Promise | {error}
	let refreshRecords = false; // after "Refresh Odoo fields": bypass the server cache
	let lastFocused = null;
	// test send: editable sample submission (not saved) and last result
	const samples = { ...window.ftoAdmin.samples };
	let testResult = null; // null | "sending" | {ok, message, url, values}

	const save = () => { store.value = JSON.stringify(state); };

	const el = (tag, attrs = {}, children = []) => {
		const node = document.createElement(tag);
		Object.entries(attrs).forEach(([k, v]) => {
			if (k === "text") node.textContent = v;
			else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
			else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v === true ? "" : v);
		});
		[].concat(children).forEach((c) => c && node.append(c));
		return node;
	};

	const ajax = (action, params) => {
		const url = new URL(ajaxUrl, location.href);
		Object.entries({ action, nonce, ...params }).forEach(([k, v]) => url.searchParams.set(k, v));
		return fetch(url, { credentials: "same-origin" })
			.then((r) => r.json())
			.then((json) => {
				if (!json.success) throw new Error(json.data?.message || "Error");
				return json.data;
			});
	};

	/* ---------- Odoo metadata ---------- */
	const loadFields = (refresh = false) => {
		if (!configured) return;
		fields = null;
		fieldsError = "";
		render();
		const model = state.model;
		ajax("fto_fields", { model, refresh: refresh ? 1 : 0 })
			.then((data) => {
				if (model !== state.model) return;
				fields = data;
				// a new mapping starts with the fields Odoo requires
				if (!state.mapping.length) {
					Object.entries(fields).forEach(([name, f]) => {
						if (f.required) state.mapping.push({ field: name, type: f.type, value: "" });
					});
					save();
				}
				if (refresh) {
					Object.keys(records).forEach((k) => delete records[k]);
					refreshRecords = true;
				}
			})
			.catch((e) => { fieldsError = e.message; fields = {}; })
			.finally(render);
	};

	const loadRecords = (relation) => {
		if (records[relation]) return;
		records[relation] = ajax("fto_records", { model: relation, refresh: refreshRecords ? 1 : 0 })
			.then((data) => { records[relation] = data; })
			.catch((e) => { records[relation] = { error: e.message }; })
			.finally(render);
	};

	const post = (action, params) => {
		const body = new FormData();
		Object.entries({ action, nonce, ...params }).forEach(([k, v]) => body.append(k, v));
		return fetch(ajaxUrl, { method: "POST", credentials: "same-origin", body }).then((r) => r.json());
	};

	const sendTest = () => {
		testResult = "sending";
		render();
		post("fto_test_send", { form_id: formId, settings: JSON.stringify(state), samples: JSON.stringify(samples) })
			.then((json) => {
				const data = json.data || {};
				testResult = json.success
					? { ok: true, message: i18n.testCreated.replace("%1$s", data.model).replace("%2$s", data.id), url: data.url, values: data.values }
					: { ok: false, message: data.message || "Error", values: data.values };
			})
			.catch((e) => { testResult = { ok: false, message: e.message }; })
			.finally(render);
	};

	const testSection = () => {
		const result = testResult && testResult !== "sending"
			? el("div", { class: `notice inline ${testResult.ok ? "notice-success" : "notice-error"} fto-test-result` }, [
				el("p", {}, [
					testResult.ok ? null : el("strong", { text: i18n.testFailed + " " }),
					testResult.message + " ",
					testResult.url ? el("a", { href: testResult.url, target: "_blank", text: i18n.testOpen }) : null,
					testResult.ok ? " " + i18n.testDelete : null,
				]),
				testResult.values && Object.keys(testResult.values).length
					? el("details", {}, [
						el("summary", { text: i18n.testSent }),
						el("pre", { text: JSON.stringify(testResult.values, null, 2) }),
					])
					: null,
			])
			: null;

		return el("div", { class: "fto-test" }, [
			el("h3", { text: i18n.test }),
			el("p", { class: "description", text: i18n.testHelp }),
			el("details", { class: "fto-samples" }, [
				el("summary", { text: i18n.testValues }),
				el("p", { class: "description", text: i18n.testValuesHelp }),
				el("table", { class: "form-table" }, el("tbody", {}, Object.keys(samples).map((name) => el("tr", {}, [
					el("th", { scope: "row" }, el("code", { text: `[${name}]` })),
					el("td", {}, (() => {
						const input = el("input", { type: "text", class: "regular-text", oninput: (e) => { samples[name] = e.target.value; } });
						input.value = samples[name];
						return input;
					})()),
				])))),
			]),
			el("p", {}, [
				el("button", {
					type: "button",
					class: "button button-secondary",
					disabled: testResult === "sending" || !state.mapping.some((r) => r.field),
					text: testResult === "sending" ? i18n.testing : i18n.test,
					onclick: sendTest,
				}),
			]),
			result,
		]);
	};

	/* ---------- Rendering ---------- */

	// Odoo choices for a selection or relational field: [[value, label]],
	// or a status element while records are loading / failed
	const odooOptions = (f) => {
		if (f.type === "selection") return f.selection || [];
		if (!f.relation) return [];
		loadRecords(f.relation);
		const list = records[f.relation];
		if (!Array.isArray(list)) {
			return el("span", { class: list?.error ? "fto-error" : "description", text: list?.error || i18n.loading });
		}
		return list.map((r) => [r.id, r.name]);
	};

	// "Map a form field": each option of a form field → an Odoo value
	const formSourceInput = (row, f) => {
		const tagNames = Object.keys(choices || {});
		if (!tagNames.length) return el("p", { class: "description", text: i18n.noChoices });

		const tagSelect = el("p", {}, [
			el("label", { text: i18n.formField + " " }),
			el("select", {
				onchange: (e) => { row.tag = e.target.value; row.map = {}; save(); render(); },
			}, [
				el("option", { value: "", text: i18n.choose }),
				...tagNames.map((name) => el("option", { value: name, text: `[${name}]`, selected: name === row.tag })),
			]),
		]);
		if (!row.tag || !choices[row.tag]) return el("div", {}, tagSelect);

		const options = odooOptions(f);
		if (!Array.isArray(options)) return el("div", {}, [tagSelect, options]);

		row.map = row.map && !Array.isArray(row.map) ? row.map : {};
		return el("div", {}, [
			tagSelect,
			el("table", { class: "fto-choice-map" }, [
				el("thead", {}, el("tr", {}, [el("th", { text: i18n.formOption }), el("th", { text: i18n.odooValue })])),
				el("tbody", {}, choices[row.tag].map((option) => el("tr", {}, [
					el("td", { text: option }),
					el("td", {}, el("select", {
						onchange: (e) => {
							const v = e.target.value;
							if (v === "" || v === "0") delete row.map[option];
							else row.map[option] = f.type === "selection" ? v : Number(v);
							save();
						},
					}, [
						el("option", { value: "", text: i18n.none }),
						...options.map(([value, label]) => el("option", { value, text: label, selected: String(row.map[option] ?? "") === String(value) })),
					])),
				]))),
			]),
			el("p", { class: "description", text: i18n.unmappedHelp }),
		]);
	};

	const valueInput = (row, index) => {
		const f = fields?.[row.field];
		const type = f ? f.type : row.type;

		// selection and relational fields: a fixed value, or one that
		// depends on what the visitor chose in the form
		if (f && ["selection", "many2one", "many2many"].includes(type)) {
			const mode = el("select", {
				class: "fto-source",
				onchange: (e) => {
					row.source = e.target.value;
					row.value = type === "many2many" ? [] : "";
					row.tag = "";
					row.map = {};
					save();
					render();
				},
			}, [
				el("option", { value: "fixed", text: i18n.sourceFixed, selected: row.source !== "form" }),
				el("option", { value: "form", text: i18n.sourceForm, selected: row.source === "form" }),
			]);
			return el("div", {}, [
				el("p", {}, mode),
				row.source === "form" ? formSourceInput(row, f) : fixedInput(row, f, type),
			]);
		}
		return fixedInput(row, f, type, index);
	};

	// Regex find & replace applied to the filled-in template
	const transformInput = (row, refresh) => {
		if (!row.transform) {
			return el("button", {
				type: "button",
				class: "button-link fto-transform-toggle",
				text: "+ " + i18n.transform,
				onclick: () => { row.transform = { pattern: "", replace: "", nomatch: "keep" }; save(); render(); },
			});
		}
		const t = row.transform;
		const field = (key, label, hint) => {
			const input = el("input", {
				type: "text",
				class: "regular-text code",
				placeholder: hint,
				oninput: (e) => { t[key] = e.target.value; save(); refresh(); },
			});
			input.value = t[key] || "";
			return el("label", {}, [el("span", { text: label }), input]);
		};
		return el("fieldset", { class: "fto-transform" }, [
			el("legend", { text: i18n.transform }),
			field("pattern", i18n.find, i18n.findHint),
			field("replace", i18n.replaceWith, i18n.replaceHint),
			el("label", {}, [
				el("span", { text: i18n.noMatch }),
				el("select", { onchange: (e) => { t.nomatch = e.target.value; save(); refresh(); } }, [
					el("option", { value: "keep", text: i18n.noMatchKeep, selected: t.nomatch !== "empty" }),
					el("option", { value: "empty", text: i18n.noMatchEmpty, selected: t.nomatch === "empty" }),
				]),
			]),
			el("button", {
				type: "button",
				class: "button-link fto-remove-transform",
				text: i18n.removeTransform,
				onclick: () => { delete row.transform; save(); render(); },
			}),
		]);
	};

	// Filled-in template → transformed value, computed by the server (PHP
	// regex); updates the given element in place to keep the input focused
	const previewTimers = new WeakMap();
	const refreshPreview = (row, target) => {
		if (!row.transform) { target.replaceChildren(); return; }
		clearTimeout(previewTimers.get(target));
		previewTimers.set(target, setTimeout(() => {
			post("fto_preview", { row: JSON.stringify(row), samples: JSON.stringify(samples) }).then((json) => {
				const d = json.data || {};
				const show = (v) => (v === "" ? i18n.previewEmpty : v);
				target.replaceChildren(
					el("span", { class: "description", text: i18n.preview + " " }),
					el("code", { text: show(d.filled ?? "") }),
					" → ",
					d.error ? el("span", { class: "fto-error", text: d.error }) : el("code", { class: d.matched === false ? "fto-nomatch" : "", text: show(d.result ?? "") }),
				);
			});
		}, 250));
	};

	const fixedInput = (row, f, type, index) => {
		if (textTypes.includes(type)) {
			const attrs = {
				class: "large-text fto-template",
				placeholder: i18n.templateHint,
				oninput: (e) => { row.value = e.target.value; save(); },
				onfocus: (e) => { lastFocused = e.target; },
			};
			const preview = el("div", { class: "fto-preview" });
			const refresh = () => refreshPreview(row, preview);
			attrs.oninput = (e) => { row.value = e.target.value; save(); refresh(); };
			const input = MULTILINE.includes(type)
				? el("textarea", { ...attrs, rows: 4 })
				: el("input", { ...attrs, type: "text" });
			input.value = row.value || "";
			input.dataset.index = index;
			if (row.transform) refresh();
			return el("div", {}, [input, transformInput(row, refresh), preview]);
		}

		if (type === "selection") {
			const select = el("select", { onchange: (e) => { row.value = e.target.value; save(); } }, [
				el("option", { value: "", text: i18n.none }),
				...(f?.selection || []).map(([key, label]) => el("option", { value: key, text: label, selected: key === row.value })),
			]);
			return select;
		}

		if (type === "many2one" || type === "many2many") {
			const relation = f?.relation;
			if (!relation) return el("em", { text: "–" });
			loadRecords(relation);
			const list = records[relation];
			if (!Array.isArray(list)) {
				return el("span", { class: list?.error ? "fto-error" : "description", text: list?.error || i18n.loading });
			}
			const multiple = type === "many2many";
			const selected = multiple ? (row.value || []).map(Number) : [Number(row.value)];
			const select = el("select", {
				multiple,
				size: multiple ? 5 : false,
				title: multiple ? i18n.multiHint : false,
				onchange: (e) => {
					const ids = [...e.target.selectedOptions].map((o) => Number(o.value)).filter(Boolean);
					row.value = multiple ? ids : (ids[0] || 0);
					save();
				},
			}, [
				multiple ? null : el("option", { value: "0", text: i18n.none }),
				...list.map((r) => el("option", { value: r.id, text: r.name, selected: selected.includes(r.id) })),
			]);
			return select;
		}

		return el("em", { text: type });
	};

	const fieldSelect = (row) => {
		const used = new Set(state.mapping.map((r) => r.field));
		const options = Object.entries(fields || {})
			.filter(([name]) => name === row.field || !used.has(name))
			.map(([name, f]) => el("option", {
				value: name,
				selected: name === row.field,
				text: `${f.label}${f.required ? ` (${i18n.required})` : ""} — ${name}`,
			}));
		const known = !row.field || fields?.[row.field];
		return el("div", {}, [
			el("select", {
				class: "fto-field",
				onchange: (e) => {
					row.field = e.target.value;
					row.type = fields[row.field]?.type || "char";
					row.value = row.type === "many2many" ? [] : "";
					delete row.source;
					delete row.tag;
					delete row.map;
					save();
					render();
				},
			}, [
				el("option", { value: "", text: i18n.choose }),
				known ? null : el("option", { value: row.field, selected: true, text: row.field }),
				...options,
			]),
			known ? null : el("div", { class: "fto-error", text: i18n.unknownField }),
		]);
	};

	const render = () => {
		const children = [];

		children.push(el("p", {}, el("label", {}, [
			el("input", {
				type: "checkbox",
				checked: !!state.enabled,
				onchange: (e) => { state.enabled = e.target.checked; save(); },
			}),
			" " + i18n.enable,
		])));

		const isKnown = Object.prototype.hasOwnProperty.call(models, state.model);
		children.push(el("p", { class: "fto-model" }, [
			el("label", { for: "fto-model", text: i18n.model + " " }),
			el("select", {
				id: "fto-model",
				onchange: (e) => {
					const value = e.target.value;
					if (value === "__other") {
						state.model = "";
						render();
						return;
					}
					state.model = value;
					state.mapping = [];
					save();
					loadFields();
				},
			}, [
				...Object.entries(models).map(([key, label]) => el("option", { value: key, text: `${label} (${key})`, selected: key === state.model })),
				el("option", { value: "__other", text: i18n.otherModel, selected: !isKnown }),
			]),
			isKnown ? null : el("input", {
				type: "text",
				class: "regular-text",
				placeholder: i18n.modelName,
				value: state.model,
				onchange: (e) => {
					state.model = e.target.value.trim().toLowerCase();
					state.mapping = [];
					save();
					loadFields();
				},
			}),
			configured && state.model ? el("button", { type: "button", class: "button-link fto-reload", text: i18n.reload, title: i18n.reloadHelp, onclick: () => loadFields(true) }) : null,
		]));

		if (!configured) {
			children.push(el("p", { class: "description", text: i18n.notConfigured }));
		} else if (!state.model) {
			// waiting for a model name
		} else if (fields === null) {
			children.push(el("p", { class: "description", text: i18n.loading }));
		} else if (fieldsError) {
			children.push(el("div", { class: "notice notice-error inline" }, el("p", { text: fieldsError })));
		} else {
			children.push(el("h3", { text: i18n.mapping }));
			children.push(el("table", { class: "widefat fto-mapping" }, [
				el("thead", {}, el("tr", {}, [
					el("th", { text: i18n.odooField }),
					el("th", { text: i18n.value }),
					el("th"),
				])),
				el("tbody", {}, state.mapping.map((row, index) => el("tr", {}, [
					el("td", {}, fieldSelect(row)),
					el("td", {}, row.field ? valueInput(row, index) : null),
					el("td", {}, el("button", {
						type: "button",
						class: "button-link fto-remove",
						"aria-label": i18n.remove,
						text: "✕",
						onclick: () => { state.mapping.splice(index, 1); save(); render(); },
					})),
				]))),
			]));
			children.push(el("p", {}, el("button", {
				type: "button",
				class: "button",
				text: i18n.addField,
				onclick: () => { state.mapping.push({ field: "", type: "char", value: "" }); save(); render(); },
			})));

			const mapped = new Set(state.mapping.map((r) => r.field));
			const missing = Object.entries(fields).filter(([name, f]) => f.required && !mapped.has(name)).map(([, f]) => f.label);
			if (missing.length) children.push(el("p", { class: "fto-warning", text: `${i18n.missingReq} ${missing.join(", ")}` }));

			if (tags.length) {
				children.push(el("div", { class: "fto-tags" }, [
					el("p", { class: "description", text: i18n.tagsHelp }),
					...tags.map((tag) => el("button", {
						type: "button",
						class: "button button-small",
						text: `[${tag}]`,
						// keep the focus (and caret) in the template being edited
						onmousedown: (e) => e.preventDefault(),
						onclick: () => insertTag(tag),
					})),
				]));
			}
		}

		if (configured && state.model && fields && !fieldsError) children.push(testSection());

		// the "Test values" panel stays open across re-renders
		const samplesOpen = root.querySelector(".fto-samples")?.open;
		root.replaceChildren(...children);
		if (samplesOpen) root.querySelector(".fto-samples").open = true;
	};

	const insertTag = (tag) => {
		const input = lastFocused && document.contains(lastFocused)
			? lastFocused
			: root.querySelector(".fto-template");
		if (!input) return;
		const text = `[${tag}]`;
		const start = input.selectionStart ?? input.value.length;
		const end = input.selectionEnd ?? input.value.length;
		input.value = input.value.slice(0, start) + text + input.value.slice(end);
		input.selectionStart = input.selectionEnd = start + text.length;
		input.focus();
		input.dispatchEvent(new Event("input"));
	};

	save();
	render();
	if (state.model) loadFields();
})();
