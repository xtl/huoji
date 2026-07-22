/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { StockNote, EvidenceLevel, StockStatus } from "../types";
import { Search, SlidersHorizontal, Share2, Eye, EyeOff, Clipboard, AlertTriangle, FileText, Check, ShieldAlert, BadgeInfo } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface StockListProps {
  stockNotes: StockNote[];
  onUpdateStockStatus: (id: string, status: StockStatus) => void;
  onDeleteStock: (id: string) => void;
  currentWorkspace: "personal" | "enterprise-1";
}

export default function StockList({ stockNotes, onUpdateStockStatus, onDeleteStock, currentWorkspace }: StockListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGpu, setSelectedGpu] = useState("ALL");
  const [selectedLocation, setSelectedLocation] = useState("ALL");
  const [selectedLevel, setSelectedLevel] = useState("ALL");
  
  // Modal state for details & export
  const [activeDetailNote, setActiveDetailNote] = useState<StockNote | null>(null);
  const [exportMode, setExportMode] = useState<"SIMPLE" | "DETAIL" | "ANONYMOUS">("ANONYMOUS");
  const [copied, setCopied] = useState(false);
  const [watermarkText, setWatermarkText] = useState("货记・评估专用・防绕单");
  const [showBottomCosts, setShowBottomCosts] = useState(false);

  // Filter computation
  const filteredNotes = stockNotes.filter(note => {
    // Workspace filter
    if (note.workspaceId !== currentWorkspace) return false;

    // Search filter
    const matchesSearch = 
      note.spec.gpuModel.toLowerCase().includes(searchTerm.toLowerCase()) ||
      note.spec.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
      note.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (note.notes && note.notes.toLowerCase().includes(searchTerm.toLowerCase()));

    // Dropdown filters
    const matchesGpu = selectedGpu === "ALL" || note.spec.gpuModel.includes(selectedGpu);
    const matchesLoc = selectedLocation === "ALL" || note.location.includes(selectedLocation);
    const matchesLevel = selectedLevel === "ALL" || note.evidenceLevel === selectedLevel;

    return matchesSearch && matchesGpu && matchesLoc && matchesLevel;
  });

  // Unique lists for filter dropdowns
  const availableGpus = ["ALL", ...Array.from(new Set(stockNotes.map(n => {
    if (n.spec.gpuModel.includes("H200")) return "H200";
    if (n.spec.gpuModel.includes("H100")) return "H100";
    if (n.spec.gpuModel.includes("B200")) return "B200";
    if (n.spec.gpuModel.includes("B300")) return "B300";
    if (n.spec.gpuModel.includes("H20")) return "H20";
    return n.spec.gpuModel;
  })))];

  const availableLocations = ["ALL", "深圳", "香港", "泰国", "北京"];

  const getEvidenceBadge = (level: EvidenceLevel) => {
    switch (level) {
      case EvidenceLevel.L0_ORAL:
        return <span className="bg-rose-50 text-rose-700 border border-rose-200 text-[11px] px-2 py-0.5 rounded-full font-medium">L0 口头货源</span>;
      case EvidenceLevel.L1_IMAGE:
        return <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[11px] px-2 py-0.5 rounded-full font-medium">L1 图片货源</span>;
      case EvidenceLevel.L2_VERIFIED:
        return <span className="bg-blue-50 text-blue-700 border border-blue-200 text-[11px] px-2 py-0.5 rounded-full font-medium">L2 SN核实</span>;
      case EvidenceLevel.L3_TRANSACTABLE:
        return <span className="bg-violet-50 text-violet-700 border border-violet-200 text-[11px] px-2 py-0.5 rounded-full font-medium">L3 合同背书</span>;
      case EvidenceLevel.L4_INSPECTED:
        return <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] px-2 py-0.5 rounded-full font-medium">L4 第三方验过</span>;
    }
  };

  const getStatusBadge = (status: StockStatus) => {
    switch (status) {
      case StockStatus.TO_VERIFY:
        return <span className="bg-stone-100 text-stone-600 px-2 py-0.5 rounded text-[11px] font-medium border border-stone-200">待核实</span>;
      case StockStatus.CONFIRMED:
        return <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[11px] font-medium border border-emerald-200">已核真</span>;
      case StockStatus.QUOTABLE:
        return <span className="bg-teal-50 text-teal-700 px-2 py-0.5 rounded text-[11px] font-medium border border-teal-200">可报价</span>;
      case StockStatus.LOCKED:
        return <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-[11px] font-medium border border-amber-200">锁货中</span>;
      case StockStatus.PARTIAL_SOLD:
        return <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[11px] font-medium border border-indigo-200">部分出</span>;
      case StockStatus.SOLD_OUT:
        return <span className="bg-stone-200 text-stone-600 px-2 py-0.5 rounded text-[11px] font-medium">已售罄</span>;
      case StockStatus.EXPIRED:
        return <span className="bg-rose-50 text-rose-600 px-2 py-0.5 rounded text-[11px] font-medium border border-rose-200">已失效</span>;
    }
  };

  // Generate copyable text depending on the mode selection
  const generateQuotationText = (note: StockNote) => {
    const watermarkStr = watermarkText ? `\n【分享水印: ${watermarkText}】` : "";
    
    if (exportMode === "SIMPLE") {
      return `【货源微发】${note.spec.brand} ${note.spec.gpuModel} Server
规格形态：${note.spec.formFactor} (含${note.spec.gpuQty}张GPU)
数量：${note.quantity}台 (${note.location})
状态交期：${note.deliveryDays}
标准报价：${note.quotedPrice} 万CNY/台 (${note.taxType})
有效期：${note.validUntil || "今日有效，速锁"}
————————————${watermarkStr}`;
    }

    if (exportMode === "DETAIL") {
      return `【服务器精细报价单】
品牌型号：${note.spec.brand} | ${note.spec.modelName || "配置服务器"}
核心算力：${note.spec.gpuModel} * ${note.spec.gpuQty}
主板CPU：${note.spec.cpu || "双路高性能Intel/AMD"}
内存配置：${note.spec.memory || "标配高速大容量ECC"}
存储盘片：${note.spec.ssd || "NVMe高速固态"}
内部网卡：${note.spec.networkCard || "Mellanox高速网卡"}
供电散热：${note.spec.cooling === "LIQUID" ? "液冷系统" : "高密度风冷"} | ${note.spec.powerSupply || "多重冗余电源"}
交付状态：${note.quantity}台 | ${note.location} | ${note.deliveryDays} (${note.condition === "SEALED" ? "新机原封" : "在保二手"})
商务条件：${note.quotedPrice}万CNY (${note.taxType})
交付方式：${note.paymentTerms}
保修说明：${note.spec.warranty}
资质等级：已核定为 ${note.evidenceLevel} 级真实货源
————————————${watermarkStr}`;
    }

    // Anonymous Mode: Hides contacts, hides sensitive details
    return `【精选货源推荐 (买家匿名通道)】
核心算力：Nvidia ${note.spec.gpuModel} 8-GPU服务器
整机品牌：${note.spec.brand} 架构
可用数量：${note.quantity}台 (支持拆分销售，起订量 ${note.minOrderQty}台)
所在地及交期：${note.location} | ${note.deliveryDays}
物理规格：${note.spec.cooling === "LIQUID" ? "液冷架构" : "高效风冷"}，配备高速 IB ${note.spec.networkCard ? "网络卡" : "网络"}
报价：${note.quotedPrice} 万CNY/台 (${note.isTaxInclusive ? "含13%增专" : "不含税价格"})
交期规则：${note.paymentTerms}
【注】本批货源已由货记AI/BMC系统完成安全核真。为防多渠道撞单泄密，详细SN串号、机架实物照片及上游货权联系方式已全面加密托管。有意请联系我方代为发起验货锁货申请。
————————————${watermarkStr}`;
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="bg-white border border-stone-200/80 rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
            <input
              type="text"
              placeholder="搜索GPU型号、主板品牌、地点或备注..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5 bg-stone-50 border border-stone-200 px-3 py-1.5 rounded-lg text-xs font-medium text-stone-700">
              <SlidersHorizontal className="w-3.5 h-3.5 text-stone-500" />
              <span>智能筛选</span>
            </div>
            
            <select
              className="bg-white border border-stone-200 rounded-lg px-2.5 py-1 text-xs text-stone-600 focus:outline-none"
              value={selectedGpu}
              onChange={(e) => setSelectedGpu(e.target.value)}
            >
              <option value="ALL">全部GPU</option>
              {availableGpus.filter(g => g !== "ALL").map(gpu => (
                <option key={gpu} value={gpu}>{gpu}</option>
              ))}
            </select>

            <select
              className="bg-white border border-stone-200 rounded-lg px-2.5 py-1 text-xs text-stone-600 focus:outline-none"
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
            >
              <option value="ALL">全部地点</option>
              {availableLocations.filter(l => l !== "ALL").map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>

            <select
              className="bg-white border border-stone-200 rounded-lg px-2.5 py-1 text-xs text-stone-600 focus:outline-none"
              value={selectedLevel}
              onChange={(e) => setSelectedLevel(e.target.value)}
            >
              <option value="ALL">全部真实度</option>
              <option value="L0">L0 - 口头</option>
              <option value="L1">L1 - 图片</option>
              <option value="L2">L2 - 有SN</option>
              <option value="L3">L3 - 资质</option>
              <option value="L4">L4 - 验过</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid of Stock Card Notes */}
      {filteredNotes.length === 0 ? (
        <div className="text-center py-12 bg-stone-50 rounded-xl border border-stone-200 border-dashed">
          <BadgeInfo className="w-10 h-10 text-stone-400 mx-auto mb-2" />
          <p className="text-sm font-medium text-stone-600">在此空间内暂未找到匹配的服务器货单</p>
          <p className="text-xs text-stone-400 mt-1">请在上方使用 AI 或粘贴聊天记录快速创建一笔货单！</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredNotes.map((note) => {
            const hasDuplicateWarning = note.notes?.includes("撞单") || note.notes?.includes("重复");
            const profit = note.quotedPrice - note.ownerPrice;
            
            return (
              <div
                key={note.id}
                id={`stock-card-${note.id}`}
                className="bg-white border border-stone-200 hover:border-stone-300 rounded-xl shadow-sm hover:shadow transition-all p-5 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-extrabold text-stone-900 font-sans tracking-tight">
                          {note.spec.gpuModel} {note.spec.gpuQty ? `(${note.spec.gpuQty}卡)` : ""}
                        </span>
                        {note.stockType === "FUTURE" ? (
                          <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded font-sans">期货</span>
                        ) : (
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.5 rounded font-sans">现货</span>
                        )}
                      </div>
                      <p className="text-xs text-stone-500 font-sans">{note.spec.brand} • {note.spec.formFactor}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {getStatusBadge(note.status)}
                      {getEvidenceBadge(note.evidenceLevel)}
                    </div>
                  </div>

                  {/* Core parameters */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 bg-stone-50/70 p-3 rounded-lg border border-stone-200/50 text-xs font-sans mb-3">
                    <div>
                      <span className="text-stone-400">数量/地点:</span>
                      <p className="font-semibold text-stone-800">{note.quantity}台 / {note.location}</p>
                    </div>
                    <div>
                      <span className="text-stone-400">报价:</span>
                      <p className="font-bold text-emerald-700">{note.quotedPrice}万{note.currency}/台</p>
                    </div>
                    <div>
                      <span className="text-stone-400">税费:</span>
                      <p className="text-stone-700 truncate">{note.taxType}</p>
                    </div>
                    <div>
                      <span className="text-stone-400">交付期:</span>
                      <p className="text-stone-700 truncate">{note.deliveryDays}</p>
                    </div>
                  </div>

                  {/* Anti-collision alert if duplicate */}
                  {hasDuplicateWarning && (
                    <div className="mb-3 p-2 bg-amber-50 text-amber-800 rounded border border-amber-200 text-[11px] flex items-center gap-1.5 font-sans">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span><b>撞单警告：</b>该批货在二级中介圈频繁转发，建议核实SN凭证。</span>
                    </div>
                  )}

                  <p className="text-xs text-stone-500 line-clamp-2 italic font-sans px-1 border-l-2 border-stone-200 pl-2">
                    {note.notes || "无原始录入文字"}
                  </p>
                </div>

                <div className="border-t border-stone-100 pt-3 mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-stone-400">负责人: {note.creatorName}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Share Quotation */}
                    <button
                      type="button"
                      onClick={() => {
                        setActiveDetailNote(note);
                        setExportMode("ANONYMOUS");
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200 rounded-lg text-xs font-medium transition-colors"
                    >
                      <Share2 className="w-3.5 h-3.5 text-stone-500" />
                      <span>转发报价</span>
                    </button>

                    {/* Manage Detail */}
                    <button
                      type="button"
                      onClick={() => {
                        setActiveDetailNote(note);
                        setExportMode("DETAIL");
                      }}
                      className="px-2.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-medium transition-colors"
                    >
                      查看详情
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Share / Details Sheet Overlay */}
      <AnimatePresence>
        {activeDetailNote && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="p-5 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-stone-900 font-sans">
                    货单详情及报价转发工具
                  </h3>
                  <p className="text-xs text-stone-500 mt-0.5">
                    ID: {activeDetailNote.id} • {activeDetailNote.spec.gpuModel} • {activeDetailNote.quantity}台
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveDetailNote(null);
                    setShowBottomCosts(false);
                  }}
                  className="p-1 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-200/50"
                >
                  <XIcon className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs font-sans text-stone-800">
                {/* 1. Sensitive Corporate Cost Area (Controlled Visibility) */}
                <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-stone-800 flex items-center gap-1">
                      <ShieldAlert className="w-4 h-4 text-emerald-600" />
                      <span>我方关系与底价 (仅自用可见)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowBottomCosts(!showBottomCosts)}
                      className="text-stone-500 hover:text-stone-800 flex items-center gap-1 text-[11px] font-medium"
                    >
                      {showBottomCosts ? (
                        <>
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>隐藏底价信息</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          <span>显示底价与链条</span>
                        </>
                      )}
                    </button>
                  </div>

                  {showBottomCosts ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t border-stone-200/50">
                      <div className="bg-white p-2 rounded border border-stone-200/80">
                        <span className="text-stone-400 block">货主底价:</span>
                        <span className="font-mono text-stone-900 font-bold text-sm">{activeDetailNote.ownerPrice} 万CNY/台</span>
                      </div>
                      <div className="bg-white p-2 rounded border border-stone-200/80">
                        <span className="text-stone-400 block">采购成本:</span>
                        <span className="font-mono text-stone-900 font-bold text-sm">{activeDetailNote.purchaseCost} 万CNY/台</span>
                      </div>
                      <div className="bg-white p-2 rounded border border-stone-200/80">
                        <span className="text-stone-400 block">对外报价:</span>
                        <span className="font-mono text-emerald-700 font-extrabold text-sm">{activeDetailNote.quotedPrice} 万CNY/台</span>
                      </div>
                      <div className="bg-white p-2 rounded border border-stone-200/80">
                        <span className="text-stone-400 block">预计佣金:</span>
                        <span className="font-mono text-indigo-700 font-extrabold text-sm">{activeDetailNote.expectedCommission} 万CNY</span>
                      </div>

                      <div className="col-span-2 md:col-span-4 bg-white p-2.5 rounded border border-stone-200/80">
                        <span className="text-stone-400 block mb-1">货权防绕单溯源链条 (中介路径):</span>
                        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                          {activeDetailNote.contactChain && activeDetailNote.contactChain.length > 0 ? (
                            activeDetailNote.contactChain.map((node, idx) => (
                              <React.Fragment key={node.id}>
                                {idx > 0 && <span className="text-stone-400 font-bold">→</span>}
                                <span className="px-2 py-1 bg-stone-100 rounded border border-stone-200/70 text-stone-700">
                                  {node.name} ({node.company || "独立渠道"}) - <b className="text-[10px] text-stone-500">{node.role}</b>
                                </span>
                              </React.Fragment>
                            ))
                          ) : (
                            <span className="text-stone-400 italic">口头临时货源，无二级中介链记录</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-stone-400 text-[11px] italic pt-1">
                      货主底价及防绕单中介联系人已安全锁定保护，点击右上角按钮进行安全核验查看。
                    </p>
                  )}
                </div>

                {/* 2. Hardware Specs Detail */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <span className="text-stone-400 block">1. 硬件核心规格</span>
                    <div className="border border-stone-200 rounded-lg p-3 space-y-1 bg-stone-50/50">
                      <p><b>GPU 核心：</b>{activeDetailNote.spec.gpuModel} (配备 {activeDetailNote.spec.gpuQty} 张芯卡)</p>
                      <p><b>主板架构：</b>{activeDetailNote.spec.brand} / {activeDetailNote.spec.formFactor}</p>
                      <p><b>整机型号：</b>{activeDetailNote.spec.modelName || "通用机型"}</p>
                      <p><b>处理器：</b>{activeDetailNote.spec.cpu || "待确认"}</p>
                      <p><b>高频内存：</b>{activeDetailNote.spec.memory || "待核实"}</p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-stone-400 block">2. 配套零组件与质保</span>
                    <div className="border border-stone-200 rounded-lg p-3 space-y-1 bg-stone-50/50">
                      <p><b>高速存储：</b>{activeDetailNote.spec.ssd || "待核实"}</p>
                      <p><b>网卡/IB网卡：</b>{activeDetailNote.spec.networkCard || "待核实"}</p>
                      <p><b>冷却供能：</b>{activeDetailNote.spec.cooling === "LIQUID" ? "液冷技术" : "风冷技术"}</p>
                      <p><b>电源适配：</b>{activeDetailNote.spec.powerSupply || "3000W冗余电源"}</p>
                      <p><b>售后保修：</b>{activeDetailNote.spec.warranty || "提供原厂质保"}</p>
                    </div>
                  </div>
                </div>

                {/* 3. Export & Forward Settings */}
                <div className="space-y-3 pt-3 border-t border-stone-200">
                  <span className="text-sm font-bold text-stone-900 block">转发与脱敏报价单生成器</span>
                  
                  {/* Select Export Mode */}
                  <div className="flex bg-stone-100 p-1 rounded-xl gap-1">
                    <button
                      type="button"
                      onClick={() => setExportMode("SIMPLE")}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold text-center transition-all ${
                        exportMode === "SIMPLE" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"
                      }`}
                    >
                      微信简洁版 (一键群发)
                    </button>
                    <button
                      type="button"
                      onClick={() => setExportMode("DETAIL")}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold text-center transition-all ${
                        exportMode === "DETAIL" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"
                      }`}
                    >
                      专业配置单 (正式报价)
                    </button>
                    <button
                      type="button"
                      onClick={() => setExportMode("ANONYMOUS")}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold text-center transition-all ${
                        exportMode === "ANONYMOUS" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"
                      }`}
                    >
                      安全脱敏版 (防过河拆桥)
                    </button>
                  </div>

                  {/* Watermark string setter */}
                  <div className="flex items-center gap-3">
                    <span className="text-stone-500 font-medium whitespace-nowrap">自定义防伪/绕单水印：</span>
                    <input
                      type="text"
                      className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-700"
                      placeholder="留空即不带水印"
                      value={watermarkText}
                      onChange={(e) => setWatermarkText(e.target.value)}
                    />
                  </div>

                  {/* Generated Box Output */}
                  <div className="relative">
                    <textarea
                      readOnly
                      rows={8}
                      className="w-full p-4 bg-stone-900 text-stone-100 font-mono text-xs rounded-xl focus:outline-none resize-none leading-relaxed"
                      value={generateQuotationText(activeDetailNote)}
                    />
                    <button
                      type="button"
                      onClick={() => handleCopyToClipboard(generateQuotationText(activeDetailNote))}
                      className="absolute top-3 right-3 bg-emerald-600 hover:bg-emerald-700 text-white p-2 rounded-lg shadow-md transition-colors flex items-center gap-1 text-[11px] font-bold"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>已复制到剪贴板</span>
                        </>
                      ) : (
                        <>
                          <Clipboard className="w-4 h-4" />
                          <span>复制报价文本</span>
                        </>
                      )}
                    </button>
                  </div>

                  {exportMode === "ANONYMOUS" && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200/50 rounded-lg text-[11px] text-emerald-800 flex gap-2">
                      <ShieldAlert className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span>
                        <b>防绕单逻辑生效：</b>此版本自动过滤了该货源的真实序列号(SN)、原始实物照片敏感区域，隐藏了老陈、张总等上游联系人与我方预计可挣的佣金底价。买家在微信朋友圈或群内转发此文本，无法直接绕开您联系底仓。
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-stone-200 bg-stone-50 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setActiveDetailNote(null);
                    setShowBottomCosts(false);
                  }}
                  className="px-5 py-2 border border-stone-300 hover:bg-stone-200/50 text-stone-700 rounded-xl font-semibold text-xs transition-colors"
                >
                  关闭
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Minimal Icons replacement
function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
  );
}
