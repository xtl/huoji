/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Approval, AuditLog, StockNote, Deal } from "../types";
import { ShieldCheck, ShieldAlert, BadgeCheck, FileCheck, Check, X, History, TrendingUp, AlertTriangle, Users, Landmark, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface EnterpriseAdminProps {
  approvals: Approval[];
  auditLogs: AuditLog[];
  stockNotes: StockNote[];
  deals: Deal[];
  onApproveReject: (id: string, status: "APPROVED" | "REJECTED", comment: string) => void;
}

export default function EnterpriseAdmin({ approvals, auditLogs, stockNotes, deals, onApproveReject }: EnterpriseAdminProps) {
  const [commentInput, setCommentInput] = useState<string>("");
  const [selectedApproval, setSelectedApproval] = useState<Approval | null>(null);

  // Stats computation for enterprise dashboard
  const activeStockCount = stockNotes.filter(n => n.workspaceId === "enterprise-1").length;
  const activeDeals = deals.filter(d => d.workspaceId === "enterprise-1");
  const totalDealRevenue = activeDeals.reduce((acc, curr) => acc + (curr.expectedRevenue || 0), 0);
  const totalDealProfit = activeDeals.reduce((acc, curr) => acc + (curr.expectedProfit || 0), 0);

  // Check for corporate collisions (撞单 / 重复货源)
  // Logic: find stocks with same location, same GPU model, similar quantities where creators differ
  const checkDuplicateCollisions = () => {
    const collisions: any[] = [];
    const entStocks = stockNotes.filter(n => n.workspaceId === "enterprise-1");
    
    for (let i = 0; i < entStocks.length; i++) {
      for (let j = i + 1; j < entStocks.length; j++) {
        const s1 = entStocks[i];
        const s2 = entStocks[j];
        
        // Match conditions: same GPU model, same location, same quantity, different creator
        if (
          s1.spec.gpuModel === s2.spec.gpuModel &&
          s1.location.substring(0, 2) === s2.location.substring(0, 2) &&
          s1.creatorId !== s2.creatorId
        ) {
          collisions.push({
            stockA: s1,
            stockB: s2,
            reason: `两份由不同销售录入的 ${s1.spec.gpuModel} (${s1.quantity}台) 货在【${s1.location}】，高度疑似来自同一上游货主底仓。`
          });
        }
      }
    }
    return collisions;
  };

  const collisions = checkDuplicateCollisions();

  const getApprovalLabel = (type: string) => {
    switch (type) {
      case "LOW_MARGIN": return "超低毛利率特批申请";
      case "CUSTOM_QUOTE": return "买方定制报价审批";
      case "PRICE_CHANGE": return "出货底价特级调整";
      default: return type;
    }
  };

  const handleAction = (status: "APPROVED" | "REJECTED") => {
    if (!selectedApproval) return;
    onApproveReject(selectedApproval.id, status, commentInput || "总经理特批处理完成");
    setSelectedApproval(null);
    setCommentInput("");
  };

  return (
    <div className="space-y-6 text-xs font-sans text-stone-800">
      
      {/* SECTION 1: Corporate Business KPI stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-stone-200/80 rounded-xl p-4 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-stone-400 block font-semibold uppercase tracking-wider text-[10px]">有效渠道货源数</span>
            <span className="text-xl font-black text-stone-900">{activeStockCount} 批现期货源</span>
          </div>
          <div className="p-3 bg-stone-50 rounded-lg text-stone-700">
            <Landmark className="w-5 h-5 text-stone-500" />
          </div>
        </div>

        <div className="bg-white border border-stone-200/80 rounded-xl p-4 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-stone-400 block font-semibold uppercase tracking-wider text-[10px]">跟进中项目流水</span>
            <span className="text-xl font-black text-emerald-700">¥ {totalDealRevenue.toFixed(1)} 万</span>
          </div>
          <div className="p-3 bg-emerald-50 rounded-lg">
            <TrendingUp className="w-5 h-5 text-emerald-600" />
          </div>
        </div>

        <div className="bg-white border border-stone-200/80 rounded-xl p-4 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-stone-400 block font-semibold uppercase tracking-wider text-[10px]">预期交易毛利润额</span>
            <span className="text-xl font-black text-indigo-700">¥ {totalDealProfit.toFixed(1)} 万</span>
          </div>
          <div className="p-3 bg-indigo-50 rounded-lg">
            <ShieldCheck className="w-5 h-5 text-indigo-600" />
          </div>
        </div>

        <div className="bg-white border border-stone-200/80 rounded-xl p-4 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-stone-400 block font-semibold uppercase tracking-wider text-[10px]">企业团队撞单警报</span>
            <span className={`text-xl font-black ${collisions.length > 0 ? "text-amber-600 animate-pulse" : "text-stone-500"}`}>
              {collisions.length} 处高度重合
            </span>
          </div>
          <div className={`p-3 rounded-lg ${collisions.length > 0 ? "bg-amber-50" : "bg-stone-50"}`}>
            <AlertTriangle className={`w-5 h-5 ${collisions.length > 0 ? "text-amber-500" : "text-stone-400"}`} />
          </div>
        </div>
      </div>

      {/* Corporate Duplicate warning block */}
      {collisions.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-1.5 text-amber-900 font-bold text-[13px]">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>检测到企业内部撞单风险 (多重渠道汇合警告)</span>
          </div>
          <div className="space-y-2 pl-6">
            {collisions.map((col, idx) => (
              <p key={idx} className="text-stone-700 leading-relaxed text-xs">
                • ⚠️ <b>【警告】：</b>{col.reason}
                <br />
                <span className="text-[11px] text-stone-500">
                  - 货单1: 录入人: {col.stockA.creatorName} / 货主底价: {col.stockA.ownerPrice}万
                  <br />
                  - 货单2: 录入人: {col.stockB.creatorName} / 货主底价: {col.stockB.ownerPrice}万
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Row 2: Approval Workflows & Action Audit Trails */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left: General Approval Queue */}
        <div className="bg-white border border-stone-200/80 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-stone-100 pb-3">
            <span className="text-sm font-bold text-stone-900 flex items-center gap-1.5">
              <FileCheck className="w-4 h-4 text-emerald-600" />
              <span>特批价格与毛利率审核中心 ({approvals.filter(a => a.status === "PENDING").length})</span>
            </span>
          </div>

          <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
            {approvals.map((app) => (
              <div
                key={app.id}
                className={`p-3.5 rounded-xl border transition-all ${
                  app.status === "PENDING"
                    ? "bg-amber-50/40 border-amber-200"
                    : app.status === "APPROVED"
                    ? "bg-emerald-50/20 border-emerald-200"
                    : "bg-stone-50 border-stone-200"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-stone-500 font-semibold uppercase">{getApprovalLabel(app.type)}</span>
                    <h5 className="font-bold text-stone-800 leading-snug">{app.details}</h5>
                  </div>
                  
                  {/* Status label */}
                  {app.status === "PENDING" ? (
                    <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[10px] font-bold">待审批</span>
                  ) : app.status === "APPROVED" ? (
                    <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[10px] font-bold">已批准</span>
                  ) : (
                    <span className="bg-stone-200 text-stone-700 px-2 py-0.5 rounded text-[10px] font-bold">已驳回</span>
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px] text-stone-500 pt-2 border-t border-stone-200/50 mt-2">
                  <span>申请人：{app.requesterName}</span>
                  <span>申请时间：{app.createdAt}</span>
                </div>

                {app.comment && (
                  <div className="mt-2 p-2 bg-white rounded border border-stone-200/50 text-[11px] text-stone-600 font-sans italic">
                    <b>批复备注:</b> {app.comment}
                  </div>
                )}

                {app.status === "PENDING" && (
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedApproval(app)}
                      className="px-3 py-1 bg-stone-900 hover:bg-stone-800 text-white rounded font-semibold text-[11px] transition-colors"
                    >
                      总经理特批处理
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Security Audit Logs */}
        <div className="bg-white border border-stone-200/80 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-stone-100 pb-3">
            <span className="text-sm font-bold text-stone-900 flex items-center gap-1.5">
              <History className="w-4 h-4 text-stone-500" />
              <span>算力池安全流转与操作审计日志 ({auditLogs.length})</span>
            </span>
          </div>

          <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="p-3 bg-stone-50 border border-stone-200/50 rounded-xl hover:bg-stone-100 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-extrabold text-stone-800">{log.action}</span>
                  <span className="text-[10px] text-stone-400 font-mono">{log.time}</span>
                </div>
                <p className="text-stone-600 leading-normal text-[11px]">{log.details}</p>
                <div className="flex items-center justify-between text-[10px] text-stone-400 pt-1.5 border-t border-stone-100 mt-1.5 font-mono">
                  <span>操作员: {log.userName}</span>
                  <span>IP/Terminal: {log.ip || "Unknown"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Interactive approval pop-up */}
      <AnimatePresence>
        {selectedApproval && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-md overflow-hidden p-5 space-y-4 text-xs font-sans text-stone-800"
            >
              <h4 className="text-sm font-extrabold text-stone-900">总经理特批决策面板</h4>
              <p className="p-3 bg-stone-50 border border-stone-200 rounded-lg text-stone-700 italic">
                “{selectedApproval.details}”
              </p>

              <div className="space-y-1">
                <label className="font-bold text-stone-500">批示评论或理由 (可留空)：</label>
                <input
                  type="text"
                  className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                  placeholder="e.g. 同意特批，尽快成交锁定周转。"
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedApproval(null)}
                  className="px-3 py-1.5 border border-stone-300 hover:bg-stone-50 text-stone-700 rounded-lg font-medium"
                >
                  暂缓
                </button>
                <button
                  type="button"
                  onClick={() => handleAction("REJECTED")}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold shadow-sm flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>驳回</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAction("APPROVED")}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-sm flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>批准特批</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
