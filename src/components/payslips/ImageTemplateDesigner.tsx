import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlignCenter, AlignLeft, AlignRight, Copy, Eye, EyeOff, Eraser, ImagePlus, Layers, Pipette,
    Plus, Square, Trash2, Type, Upload, Wand2, ZoomIn, ZoomOut,
} from 'lucide-react';
import { PayslipTemplateContent, VisualField } from '../../types/payslip';
import { compressImageFile, compressCanvas } from '../../lib/imageUtils';
import {
    PAGE_WIDTH_PX, VISUAL_FIELD_OPTIONS, defaultItem, isMoneyKey, sampleImageColor, visualItemText,
} from '../../lib/visualTemplate';
import { DEFAULT_PAYSLIP } from '../../lib/defaultTemplate';
import { pageHeightPx, payslipToVisualData, visualItemStyle } from './VisualPayslipPage';

type Content = PayslipTemplateContent;
type ShowToast = (type: 'success' | 'error' | 'info', message: string) => void;

interface Props {
    content: Content;
    setContent: (updater: (prev: Content) => Content) => void;
    showToast: ShowToast;
}

const IMAGE_OPTS = { maxWidth: 1654, maxHeight: 2339, format: 'jpeg' as const, quality: 0.88, maxBytes: 1300 * 1024 };
const SAMPLE = payslipToVisualData(DEFAULT_PAYSLIP as any);
const GROUPS = ['Employee', 'Earnings', 'Deductions', 'Totals'] as const;

function imageAspect(src: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalHeight / img.naturalWidth);
        img.onerror = () => reject(new Error('Could not read this image'));
        img.src = src;
    });
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function ImageTemplateDesigner({ content, setContent, showToast }: Props) {
    const cfg = content.visualConfig;
    const image = cfg?.backgroundImage || '';
    const fields: VisualField[] = useMemo(() => cfg?.fields || [], [cfg?.fields]);
    const aspect = cfg?.aspectRatio;
    const pageH = pageHeightPx({ aspectRatio: aspect });

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [zoom, setZoom] = useState(1);
    const [showValues, setShowValues] = useState(true);
    const [busy, setBusy] = useState(false);
    const canvasRef = useRef<HTMLDivElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const selected = fields.find(f => f.id === selectedId) || null;

    // ----- state helpers -------------------------------------------------------------------
    const setFields = useCallback((fn: (prev: VisualField[]) => VisualField[]) => {
        setContent(prev => ({
            ...prev,
            type: 'visual',
            visualConfig: {
                backgroundImage: prev.visualConfig?.backgroundImage || '',
                aspectRatio: prev.visualConfig?.aspectRatio,
                fields: fn(prev.visualConfig?.fields || []),
            },
        }));
    }, [setContent]);

    const updateItem = useCallback((id: string, updates: Partial<VisualField>) => {
        setFields(prev => prev.map(f => (f.id === id ? { ...f, ...updates } : f)));
    }, [setFields]);

    const addItem = (item: VisualField) => {
        // drop new items near the middle of what's currently visible
        setFields(prev => [...prev, { ...item, y: clamp(30 + (prev.length % 8) * 4, 0, 90) }]);
        setSelectedId(item.id);
    };

    const removeItem = useCallback((id: string) => {
        setFields(prev => prev.filter(f => f.id !== id));
        setSelectedId(null);
    }, [setFields]);

    const duplicateItem = useCallback((id: string) => {
        const src = fields.find(f => f.id === id);
        if (!src) return;
        const copy = { ...src, id: Math.random().toString(36).slice(2, 11), x: clamp(src.x + 1.5, 0, 98), y: clamp(src.y + 2, 0, 98) };
        setFields(prev => [...prev, copy]);
        setSelectedId(copy.id);
    }, [fields, setFields]);

    // ----- upload ----------------------------------------------------------------------------
    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const input = e.target;
        const file = input.files?.[0];
        if (!file) return;
        setBusy(true);
        try {
            let dataUrl: string;
            if (file.type === 'application/pdf') {
                const pdfjsLib = (window as any).pdfjsLib;
                if (!pdfjsLib) throw new Error('PDF reader could not be loaded (check internet connection). Please upload a PNG/JPG instead.');
                const pdf = await pdfjsLib.getDocument(new Uint8Array(await file.arrayBuffer())).promise;
                const page = await pdf.getPage(1);
                const viewport = page.getViewport({ scale: 2.5 });
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Canvas is not available in this browser.');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                await page.render({ canvasContext: ctx, viewport }).promise;
                dataUrl = compressCanvas(canvas, IMAGE_OPTS);
            } else {
                dataUrl = await compressImageFile(file, IMAGE_OPTS);
            }
            const aspectRatio = await imageAspect(dataUrl);
            setContent(prev => ({
                ...prev,
                type: 'visual',
                visualConfig: { backgroundImage: dataUrl, aspectRatio, fields: prev.visualConfig?.fields || [] },
            }));
            showToast('success', 'Image loaded. Now add fields, text and cover boxes on top of it.');
        } catch (err) {
            console.error('Image template upload error:', err);
            showToast('error', (err as Error).message || 'Failed to load file. Please try a PNG/JPG image.');
        } finally {
            setBusy(false);
            input.value = '';
        }
    };

    const removeImage = () => {
        setContent(prev => ({
            ...prev,
            visualConfig: { backgroundImage: '', aspectRatio: undefined, fields: prev.visualConfig?.fields || [] },
        }));
    };

    // ----- colour helpers ---------------------------------------------------------------------
    const matchPaper = async (f: VisualField) => {
        try {
            const w = f.width ?? 10;
            const h = f.height ?? 2.5;
            const off = 0.4;
            const pts: { x: number; y: number }[] = [];
            for (const t of [0.25, 0.5, 0.75]) {
                pts.push({ x: f.x - off, y: f.y + h * t });
                pts.push({ x: f.x + w + off, y: f.y + h * t });
                pts.push({ x: f.x + w * t, y: f.y - off });
                pts.push({ x: f.x + w * t, y: f.y + h + off });
            }
            const color = await sampleImageColor(image, pts);
            updateItem(f.id, { bgColor: color });
        } catch (err) {
            showToast('error', (err as Error).message);
        }
    };

    const pickWithEyedropper = async (f: VisualField, target: 'bgColor' | 'color') => {
        const EyeDropperCtor = (window as any).EyeDropper;
        if (!EyeDropperCtor) {
            showToast('info', 'Eyedropper needs Chrome or Edge. Use "Match paper" or the colour box instead.');
            return;
        }
        try {
            const result = await new EyeDropperCtor().open();
            updateItem(f.id, { [target]: result.sRGBHex } as Partial<VisualField>);
        } catch {
            /* user cancelled */
        }
    };

    // ----- drag / resize ------------------------------------------------------------------------
    const startDrag = (e: React.PointerEvent, f: VisualField, mode: 'move' | 'resize') => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        setSelectedId(f.id);
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const origin = { x: f.x, y: f.y, w: f.width, h: f.height };
        // items without an explicit size start from what they currently occupy on screen
        const el = (e.currentTarget as HTMLElement).closest('[data-item]') as HTMLElement | null;
        const box = el?.getBoundingClientRect();
        const curW = origin.w ?? (box ? (box.width / rect.width) * 100 : 10);
        const curH = origin.h ?? (box ? (box.height / rect.height) * 100 : 2.5);

        const onMove = (ev: PointerEvent) => {
            const dx = ((ev.clientX - startX) / rect.width) * 100;
            const dy = ((ev.clientY - startY) / rect.height) * 100;
            if (mode === 'move') {
                updateItem(f.id, {
                    x: round1(clamp(origin.x + dx, 0, 100 - Math.min(curW, 100))),
                    y: round1(clamp(origin.y + dy, 0, 100 - Math.min(curH, 100))),
                });
            } else {
                updateItem(f.id, {
                    width: round1(clamp(curW + dx, 1, 100 - origin.x)),
                    height: round1(clamp(curH + dy, 0.8, 100 - origin.y)),
                });
            }
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    // keyboard: arrows nudge, Delete removes, Ctrl+D duplicates
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
            if (!selectedId) return;
            const step = e.shiftKey ? 1 : 0.1;
            const f = fields.find(i => i.id === selectedId);
            if (!f) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); updateItem(f.id, { x: round1(clamp(f.x - step, 0, 100)) }); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); updateItem(f.id, { x: round1(clamp(f.x + step, 0, 100)) }); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); updateItem(f.id, { y: round1(clamp(f.y - step, 0, 100)) }); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); updateItem(f.id, { y: round1(clamp(f.y + step, 0, 100)) }); }
            else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeItem(f.id); }
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateItem(f.id); }
            else if (e.key === 'Escape') setSelectedId(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selectedId, fields, updateItem, removeItem, duplicateItem]);

    // ----- small UI pieces -----------------------------------------------------------------------
    const label = 'text-[9px] font-bold text-slate-500 uppercase tracking-wide';
    const inputCls = 'w-full text-xs p-2 border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700';

    const num = (field: 'x' | 'y' | 'width' | 'height', title: string) => (
        <div className="space-y-1">
            <label className={label}>{title}</label>
            <input
                type="number"
                step="0.1"
                className={inputCls}
                value={selected?.[field] ?? ''}
                placeholder="auto"
                onChange={(e) => {
                    if (!selected) return;
                    const v = e.target.value === '' ? undefined : parseFloat(e.target.value);
                    updateItem(selected.id, { [field]: v } as Partial<VisualField>);
                }}
            />
        </div>
    );

    const itemTitle = (f: VisualField) => {
        const kind = f.kind || 'field';
        if (kind === 'cover') return 'Cover box';
        if (kind === 'text') return `Text: ${(f.text || '').slice(0, 24) || '(empty)'}`;
        return VISUAL_FIELD_OPTIONS.find(o => o.key === f.key)?.label || f.name;
    };

    const renderSettings = (f: VisualField) => {
        const kind = f.kind || 'field';
        return (
            <div className="p-4 bg-blue-50/60 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-900/30 space-y-3">
                <div className="flex items-center justify-between">
                    <h5 className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400">
                        {kind === 'cover' ? 'Cover box' : kind === 'text' ? 'Text box' : 'Data field'} settings
                    </h5>
                    <div className="flex items-center gap-1">
                        <button onClick={() => duplicateItem(f.id)} title="Duplicate (Ctrl+D)" className="p-1.5 text-slate-500 hover:bg-white rounded-md"><Copy size={14} /></button>
                        <button onClick={() => removeItem(f.id)} title="Delete (Del)" className="p-1.5 text-red-500 hover:bg-red-50 rounded-md"><Trash2 size={14} /></button>
                    </div>
                </div>

                {kind === 'text' && (
                    <div className="space-y-1">
                        <label className={label}>Text</label>
                        <input className={inputCls} value={f.text || ''} onChange={(e) => updateItem(f.id, { text: e.target.value })} />
                    </div>
                )}

                {kind === 'field' && (
                    <div className="space-y-1">
                        <label className={label}>Shows</label>
                        <select
                            className={inputCls}
                            value={f.key || ''}
                            onChange={(e) => {
                                const key = e.target.value;
                                const opt = VISUAL_FIELD_OPTIONS.find(o => o.key === key);
                                updateItem(f.id, { key, name: opt?.label || key, align: isMoneyKey(key) ? 'right' : f.align });
                            }}
                        >
                            {GROUPS.map(g => (
                                <optgroup key={g} label={g}>
                                    {VISUAL_FIELD_OPTIONS.filter(o => o.group === g).map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                                </optgroup>
                            ))}
                        </select>
                    </div>
                )}

                {kind !== 'cover' && (
                    <>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <label className={label}>Font size</label>
                                <input type="number" className={inputCls} value={f.fontSize} onChange={(e) => updateItem(f.id, { fontSize: parseFloat(e.target.value) || 12 })} />
                            </div>
                            <div className="space-y-1">
                                <label className={label}>Weight</label>
                                <select className={inputCls} value={f.fontWeight} onChange={(e) => updateItem(f.id, { fontWeight: e.target.value })}>
                                    <option value="normal">Regular</option>
                                    <option value="medium">Medium</option>
                                    <option value="bold">Bold</option>
                                    <option value="black">Heavy</option>
                                </select>
                            </div>
                        </div>
                        <div className="flex items-end justify-between gap-3">
                            <div className="space-y-1">
                                <label className={label}>Align</label>
                                <div className="flex border rounded-lg overflow-hidden bg-white dark:bg-slate-800">
                                    {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, Icon]) => (
                                        <button
                                            key={a}
                                            onClick={() => updateItem(f.id, { align: a })}
                                            className={`p-2 ${(f.align || 'left') === a ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                                        >
                                            <Icon size={13} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className={label}>Text colour</label>
                                <div className="flex items-center gap-1">
                                    <input type="color" value={f.color || '#000000'} onChange={(e) => updateItem(f.id, { color: e.target.value })} className="h-8 w-10 rounded border cursor-pointer" />
                                    <button onClick={() => pickWithEyedropper(f, 'color')} title="Pick colour from the screen" className="p-2 border rounded-lg bg-white text-slate-500 hover:text-blue-600"><Pipette size={13} /></button>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {kind === 'field' && isMoneyKey(f.key) && (
                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <input type="checkbox" checked={!!f.showSymbol} onChange={(e) => updateItem(f.id, { showSymbol: e.target.checked })} />
                        Show ₹ symbol
                    </label>
                )}

                <div className="space-y-1.5 pt-2 border-t border-blue-100 dark:border-blue-900/30">
                    <label className={label}>{kind === 'cover' ? 'Cover colour' : 'Fill behind text (hides old value)'}</label>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <input type="color" value={f.bgColor || '#ffffff'} onChange={(e) => updateItem(f.id, { bgColor: e.target.value })} className="h-8 w-10 rounded border cursor-pointer" />
                        <button onClick={() => matchPaper(f)} className="px-2 py-1.5 text-[11px] border rounded-lg bg-white text-slate-600 hover:text-blue-600 flex items-center gap-1" title="Copy the colour of the image just outside this box">
                            <Wand2 size={12} /> Match paper
                        </button>
                        <button onClick={() => pickWithEyedropper(f, 'bgColor')} className="p-2 border rounded-lg bg-white text-slate-500 hover:text-blue-600" title="Pick colour from the screen"><Pipette size={13} /></button>
                        {kind !== 'cover' && (
                            <button onClick={() => updateItem(f.id, { bgColor: '' })} className="px-2 py-1.5 text-[11px] border rounded-lg bg-white text-slate-500 hover:text-red-500" title="No fill">
                                None
                            </button>
                        )}
                    </div>
                    <p className="text-[10px] text-slate-400">Size the box so it fully covers the old printed text, then click Match paper.</p>
                </div>

                <div className="grid grid-cols-4 gap-2">
                    {num('x', 'X %')}
                    {num('y', 'Y %')}
                    {num('width', 'W %')}
                    {num('height', 'H %')}
                </div>
                <p className="text-[10px] text-slate-400">Drag to move, drag the corner handle to resize. Arrow keys nudge (Shift = bigger steps).</p>
            </div>
        );
    };

    // ----- render ----------------------------------------------------------------------------------
    const covers = fields.filter(f => f.kind === 'cover');
    const others = fields.filter(f => f.kind !== 'cover');

    const renderItem = (f: VisualField) => {
        const isSel = selectedId === f.id;
        const kind = f.kind || 'field';
        const text = kind === 'cover' ? '' : showValues ? visualItemText(f, SAMPLE) : (kind === 'text' ? (f.text || '') : `{${itemTitle(f)}}`);
        return (
            <div
                key={f.id}
                data-item
                onPointerDown={(e) => startDrag(e, f, 'move')}
                style={{
                    ...visualItemStyle(f),
                    overflow: 'visible',
                    cursor: 'move',
                    userSelect: 'none',
                    touchAction: 'none',
                    outline: isSel ? '2px solid #3b82f6' : '1px dashed rgba(59,130,246,0.55)',
                    outlineOffset: 0,
                    // keep empty/transparent items easy to find and grab
                    backgroundColor: f.bgColor || (isSel ? 'rgba(59,130,246,0.10)' : 'transparent'),
                    minWidth: kind === 'cover' ? undefined : 8,
                    minHeight: 8,
                    zIndex: isSel ? 20 : 10,
                }}
                title={itemTitle(f)}
            >
                <span style={{ overflow: 'hidden', textOverflow: 'clip', maxWidth: '100%' }}>{text}</span>
                {isSel && (
                    <span
                        onPointerDown={(e) => startDrag(e, f, 'resize')}
                        className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-blue-600 border border-white rounded-sm"
                        style={{ cursor: 'nwse-resize', touchAction: 'none' }}
                    />
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-1 overflow-hidden">
            {/* ----- left panel ----- */}
            <div className="w-96 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col shadow-xl z-40">
                <div className="flex-1 overflow-y-auto p-5 space-y-6">
                    <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-4 rounded-xl text-white shadow-lg shadow-blue-500/20">
                        <h4 className="text-sm font-bold flex items-center gap-2 mb-1"><ImagePlus size={16} /> Image Template</h4>
                        <p className="text-[11px] opacity-90 leading-relaxed">
                            Your image <b>is</b> the payslip. Hide what you don't need with cover boxes, then place data fields and your own text on top.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">1. Payslip image</h5>
                        <input ref={fileRef} type="file" className="hidden" accept="image/*,application/pdf" onChange={handleUpload} />
                        <div className="flex gap-2">
                            <button
                                onClick={() => fileRef.current?.click()}
                                disabled={busy}
                                className="flex-1 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs flex items-center justify-center gap-2 hover:border-blue-500 hover:bg-blue-50/50 text-slate-600 dark:text-slate-300 transition-all disabled:opacity-60"
                            >
                                <Upload size={14} /> {busy ? 'Loading…' : image ? 'Change image' : 'Upload PNG / JPG / PDF'}
                            </button>
                            {image && (
                                <button onClick={removeImage} className="px-3 border border-slate-200 rounded-xl text-red-500 hover:bg-red-50" title="Remove image (keeps your boxes)">
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                        <p className="text-[10px] text-slate-400">PDFs use their first page. The page keeps your image's exact shape, so nothing is stretched.</p>
                    </div>

                    {image && (
                        <>
                            {selected && renderSettings(selected)}

                            <div className="space-y-2">
                                <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">2. Add to the page</h5>
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => addItem(defaultItem('cover'))} className="p-2.5 text-xs bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 hover:text-blue-600 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-2">
                                        <Eraser size={13} /> Cover box
                                    </button>
                                    <button onClick={() => addItem(defaultItem('text'))} className="p-2.5 text-xs bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 hover:text-blue-600 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-2">
                                        <Type size={13} /> Text box
                                    </button>
                                </div>
                                {GROUPS.map(g => (
                                    <div key={g}>
                                        <p className="text-[9px] font-bold text-slate-400 uppercase mt-3 mb-1.5">{g}</p>
                                        <div className="grid grid-cols-2 gap-1.5">
                                            {VISUAL_FIELD_OPTIONS.filter(o => o.group === g).map(o => (
                                                <button
                                                    key={o.key}
                                                    onClick={() => addItem(defaultItem('field', o.key, o.label))}
                                                    className="px-2 py-1.5 text-[11px] text-left bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
                                                >
                                                    <Plus size={10} className="shrink-0 text-blue-500" /> <span className="truncate">{o.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="space-y-2">
                                <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5"><Layers size={11} /> On this page ({fields.length})</h5>
                                {fields.length === 0 && <p className="text-[11px] text-slate-400">Nothing added yet.</p>}
                                <div className="space-y-1">
                                    {fields.map(f => (
                                        <button
                                            key={f.id}
                                            onClick={() => setSelectedId(f.id)}
                                            className={`w-full text-left text-[11px] px-2.5 py-1.5 rounded-md border flex items-center gap-2 ${selectedId === f.id ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50'}`}
                                        >
                                            {f.kind === 'cover' ? <Square size={11} style={{ color: f.bgColor || '#fff' }} className="shrink-0 fill-current stroke-slate-400" /> : f.kind === 'text' ? <Type size={11} className="shrink-0" /> : <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
                                            <span className="truncate">{itemTitle(f)}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ----- canvas ----- */}
            <div className="flex-1 bg-slate-200 dark:bg-slate-950 overflow-auto relative custom-scrollbar" onPointerDown={() => setSelectedId(null)}>
                <div className="sticky top-3 z-30 flex justify-center pointer-events-none">
                    <div className="pointer-events-auto flex items-center gap-3 px-3 py-1.5 bg-white/90 dark:bg-slate-800/90 backdrop-blur rounded-full border border-white dark:border-slate-700 shadow-sm text-[11px] font-medium text-slate-600" onPointerDown={(e) => e.stopPropagation()}>
                        <button onClick={() => setShowValues(v => !v)} className="flex items-center gap-1.5 hover:text-blue-600" title="Switch between sample values and field names">
                            {showValues ? <Eye size={13} className="text-blue-500" /> : <EyeOff size={13} />}
                            {showValues ? 'Sample values' : 'Field names'}
                        </button>
                        <span className="h-4 w-px bg-slate-200" />
                        <button onClick={() => setZoom(z => clamp(round1(z - 0.1), 0.4, 2))} className="hover:text-blue-600"><ZoomOut size={14} /></button>
                        <span className="w-9 text-center">{Math.round(zoom * 100)}%</span>
                        <button onClick={() => setZoom(z => clamp(round1(z + 0.1), 0.4, 2))} className="hover:text-blue-600"><ZoomIn size={14} /></button>
                    </div>
                </div>

                <div className="flex justify-center p-10 pt-6">
                    {!image ? (
                        <div className="bg-white shadow-2xl rounded-xl flex flex-col items-center justify-center gap-4 text-slate-400 border-4 border-dashed border-slate-300" style={{ width: PAGE_WIDTH_PX, height: pageH }}>
                            <ImagePlus size={48} />
                            <p className="font-semibold">Upload your payslip image to start</p>
                            <button onClick={() => fileRef.current?.click()} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Choose image</button>
                        </div>
                    ) : (
                        <div style={{ width: PAGE_WIDTH_PX * zoom, height: pageH * zoom }}>
                            <div
                                ref={canvasRef}
                                className="relative bg-white shadow-2xl"
                                onPointerDown={(e) => { e.stopPropagation(); setSelectedId(null); }}
                                style={{
                                    width: PAGE_WIDTH_PX,
                                    height: pageH,
                                    transform: `scale(${zoom})`,
                                    transformOrigin: 'top left',
                                    backgroundImage: `url(${image})`,
                                    backgroundSize: '100% 100%',
                                    backgroundRepeat: 'no-repeat',
                                }}
                            >
                                {covers.map(renderItem)}
                                {others.map(renderItem)}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}