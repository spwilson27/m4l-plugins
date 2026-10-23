{
	"patcher": {
		"fileversion": 1,
		"appversion": {
			"major": 9,
			"minor": 1,
			"revision": 0,
			"architecture": "x64",
			"modernui": 1
		},
		"classnamespace": "box",
		"rect": [
			60.0,
			60.0,
			400.0,
			200.0
		],
		"bglocked": 0,
		"openinpresentation": 1,
		"default_fontsize": 10.0,
		"default_fontface": 0,
		"default_fontname": "Arial Bold",
		"gridonopen": 1,
		"gridsize": [
			8.0,
			8.0
		],
		"statusbarvisible": 0,
		"toolbarvisible": 0,
		"boxanimatetime": 200,
		"boxes": [
			{
				"box": {
					"border": 0,
					"filename": "none",
					"id": "obj-count-df",
					"maxclass": "v8ui",
					"numinlets": 1,
					"numoutlets": 0,
					"outlettype": [],
					"patching_rect": [
						400.0,
						300.0,
						64.0,
						16.0
					],
					"textfile": {
						"text": "\ninlets = 1; outlets = 1;\nvar NAME = \"sdf\"; var n = 0;\nfunction note(a) {\n    var s = String(a.join(\" \"));\n    if (s === \"none\" || s === \"\" || s === \"bang\") return;\n    n++;\n    try { var g = new Global(\"dropprobe\"); g[NAME] = n; g[NAME + \"_last\"] = s; } catch (e) {}\n    try { var f = new File(\"/tmp/dropprobe_\" + NAME + \".txt\", \"write\"); if (f.isopen) { f.writestring(n + \" \" + s); f.close(); } } catch (e2) {}\n    post(\"dropprobe \" + NAME + \" \" + n + \" \" + s + \"\\n\");\n}\nfunction anything() { note([messagename].concat(arrayfromargs(arguments))); }\nfunction symbol(s) { note([s]); }\nfunction list() { note(arrayfromargs(arguments)); }\n",
						"filename": "none",
						"flags": 0,
						"embed": 1,
						"autowatch": 1
					}
				}
			},
			{
				"box": {
					"border": 0,
					"filename": "none",
					"id": "obj-count-ld",
					"maxclass": "v8ui",
					"numinlets": 1,
					"numoutlets": 0,
					"outlettype": [],
					"patching_rect": [
						400.0,
						300.0,
						64.0,
						16.0
					],
					"textfile": {
						"text": "\ninlets = 1; outlets = 1;\nvar NAME = \"sld\"; var n = 0;\nfunction note(a) {\n    var s = String(a.join(\" \"));\n    if (s === \"none\" || s === \"\" || s === \"bang\") return;\n    n++;\n    try { var g = new Global(\"dropprobe\"); g[NAME] = n; g[NAME + \"_last\"] = s; } catch (e) {}\n    try { var f = new File(\"/tmp/dropprobe_\" + NAME + \".txt\", \"write\"); if (f.isopen) { f.writestring(n + \" \" + s); f.close(); } } catch (e2) {}\n    post(\"dropprobe \" + NAME + \" \" + n + \" \" + s + \"\\n\");\n}\nfunction anything() { note([messagename].concat(arrayfromargs(arguments))); }\nfunction symbol(s) { note([s]); }\nfunction list() { note(arrayfromargs(arguments)); }\n",
						"filename": "none",
						"flags": 0,
						"embed": 1,
						"autowatch": 1
					}
				}
			},
			{
				"box": {
					"bgcolor": [
						0,
						0,
						0,
						0
					],
					"border": 0,
					"bordercolor": [
						0,
						0,
						0,
						0
					],
					"id": "obj-drop",
					"ignoreclick": 1,
					"maxclass": "dropfile",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						""
					],
					"patching_rect": [
						20.0,
						120.0,
						200.0,
						200.0
					],
					"presentation": 1,
					"presentation_rect": [
						0.0,
						0.0,
						200.0,
						200.0
					]
				}
			},
			{
				"box": {
					"bordercolor": [
						0.28,
						0.78,
						0.94,
						0.85
					],
					"fontsize": 8.0,
					"id": "obj-ld",
					"legend": "Drop",
					"maxclass": "live.drop",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						""
					],
					"parameter_enable": 1,
					"patching_rect": [
						220.0,
						120.0,
						200.0,
						200.0
					],
					"textcolor": [
						0.84,
						0.92,
						0.98,
						1.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_invisible": 1,
							"parameter_longname": "Probe File",
							"parameter_modmode": 0,
							"parameter_shortname": "Probe File",
							"parameter_type": 4
						}
					},
					"varname": "Probe File",
					"presentation": 1,
					"presentation_rect": [
						200.0,
						0.0,
						200.0,
						200.0
					]
				}
			},
			{
				"box": {
					"angle": 270.0,
					"background": 1,
					"bgcolor": [
						1.0,
						0.0,
						1.0,
						1.0
					],
					"border": 0,
					"id": "obj-panel",
					"maxclass": "panel",
					"mode": 0,
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						10.0,
						10.0,
						400.0,
						200.0
					],
					"presentation": 1,
					"presentation_rect": [
						0.0,
						0.0,
						400.0,
						200.0
					],
					"rounded": 0
				}
			}
		],
		"lines": [
			{
				"patchline": {
					"source": [
						"obj-drop",
						0
					],
					"destination": [
						"obj-count-df",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ld",
						0
					],
					"destination": [
						"obj-count-ld",
						0
					]
				}
			}
		],
		"parameters": {},
		"dependency_cache": [],
		"autosave": 0
	}
}