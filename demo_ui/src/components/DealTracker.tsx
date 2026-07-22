/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { Deal, DealStage } from "../types";
import { Kanban, ArrowRight, ShieldAlert, Calendar, CheckSquare, Plus, CheckCircle, Flame, CircleAlert, DollarSign } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface DealTrackerProps {
  deals: Deal[];
  onUpdateDealStage: (id: string, stage: DealStage) => void;
  onUpdateDealAction: (id: string, blocker: string, nextStep: string) => void;
  currentWorkspace: "personal" | "enterprise-1";
}

export default function DealTracker({ deals, onUpdateDealStage, onUpdateDealAction, currentWorkspace }: DealTrackerProps) {
  const [activeDealEdit, setActiveDealEdit] = useState<Deal | null>(null);
  const [blockerInput, setBlockerInput] = useState("");
  const [nextStepInput, setNextStepInput] = useState("");

  const workspaceDeals = deals.filter(d => d.workspaceId === currentWorkspace);

  // Group Deal Stages into standard trade blocks
  const stagesMap = [
    {
      title: "意向商谈 (Negotiation)",
      stages: [DealStage.CONTACT, DealStage.CONFIRM_DEMAND, DealStage.MATCH_STOCK, DealStage.QUOTED, DealStage.INTERESTED],
      color: "bg-stone-100 border-stone-200 text-stone-700"
    },
    {
      title: "锁货验机 (Security & Inspection)",
      stages: [DealStage.LOCKED, DealStage.INSPECTING],
      color: "bg-blue-50 border-blue-100 text-blue-700"
    },
    {
      title: "签约付款 (Contract & Payment)",
      stages: [DealStage.CONTRACT, DealStage.PAYING],
      color: "bg-amber-50 border-amber-100 text-amber-700"
    },
    {
      title: "履行交付 (Fulfillment)",
      stages: [DealStage.DELIVERING],
      color: "bg-violet-50 border-violet-100 text-violet-700"
    },
    {
      title: "交易结束 (Archived)",
      stages: [DealStage.CLOSED_WON, DealStage.CLOSED_LOST],
      color: "bg-emerald-50 border-emerald-100 text-emerald-700"
    }
  ];

  const getStageLabel = (stage: DealStage) => {
    switch (stage) {
      case DealStage.CONTACT: return "初步接触";
      case DealStage.CONFIRM_DEMAND: return "需求确认";
      case DealStage.MATCH_STOCK: return "货源匹配";
      case DealStage.QUOTED: return "已报价";
      case DealStage.INTERESTED: return "买家有意向";
      case DealStage.LOCKED: return "锁定货物";
      case DealStage.INSPECTING: return "机房验货";
      case DealStage.CONTRACT: return "签约合同";
      case DealStage.PAYING: return "等待付款";
      case DealStage.DELIVERING: return "物流交付";
      case DealStage.CLOSED_WON: return "交易成功 🎉";
      case DealStage.CLOSED_LOST: return "交易失败 ❌";
    }
  };

  const handleOpenEdit = (deal: Deal) => {
    setActiveDealEdit(deal);
    setBlockerInput(deal.currentBlocker || "");
    setNextStepInput(deal.nextStep || "");
  };

  const handleSaveAction = () => {
    if (!activeDealEdit) return;
    onUpdateDealAction(activeDealEdit.id, blockerInput, nextStepInput);
    setActiveDealEdit(null);
  };

  return (
    <div className="space-y-6">
      
      {/* Header text */}
      <div>
        <h3 className="text-base font-bold text-stone-900 font-sans">
          轻量级算力贸易跟进 (轻CRM)
        </h3>
        <p className="text-xs text-stone-500">
          针对服务器贸易链条设计的专属流程看板。实时提醒每一笔服务器货源从锁货、机房核查到合同打款的卡点问题。
        </p>
      </div>

      {/* Main Kanban Board */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {stagesMap.map((group, colIdx) => {
          const groupDeals = workspaceDeals.filter(d => group.stages.includes(d.stage));
          
          return (
            <div
              key={colIdx}
              className="bg-stone-50/50 border border-stone-200/80 rounded-2xl p-4 flex flex-col min-h-[500px]"
            >
              {/* Header of Column Group */}
              <div className={`p-2.5 rounded-xl border mb-3 flex items-center justify-between font-sans ${group.color}`}>
                <span className="text-xs font-bold tracking-tight">{group.title}</span>
                <span className="text-[11px] font-mono font-bold bg-white/75 px-1.5 py-0.5 rounded shadow-sm">
                  {groupDeals.length}
                </span>
              </div>

              {/* Deal Cards Inside */}
              <div className="space-y-3 flex-1 overflow-y-auto max-h-[600px] pr-1">
                {groupDeals.length === 0 ? (
                  <div className="text-center py-8 text-stone-400 italic text-[11px] border border-stone-200/50 rounded-xl border-dashed">
                    空空如也
                  </div>
                ) : (
                  groupDeals.map(deal => {
                    const isHot = deal.stage === DealStage.LOCKED || deal.stage === DealStage.INSPECTING;
                    return (
                      <div
                        key={deal.id}
                        onClick={() => handleOpenEdit(deal)}
                        className={`bg-white border hover:border-stone-400 p-3.5 rounded-xl shadow-sm transition-all cursor-pointer space-y-2 text-xs font-sans relative overflow-hidden ${
                          isHot ? "ring-1 ring-amber-400/50" : ""
                        }`}
                      >
                        {isHot && (
                          <div className="absolute top-0 right-0 bg-amber-500 text-white font-mono text-[9px] px-1.5 py-0.5 rounded-bl">
                            重要保障
                          </div>
                        )}

                        <div className="space-y-0.5">
                          <span className="text-[10px] text-stone-400 block font-semibold">{getStageLabel(deal.stage)}</span>
                          <h4 className="font-extrabold text-stone-800 leading-tight">{deal.name}</h4>
                        </div>

                        {/* Financial Indicators */}
                        <div className="flex gap-2 text-[10px] bg-stone-50 p-1.5 rounded border border-stone-100">
                          <div>
                            <span className="text-stone-400">总包:</span>
                            <span className="font-bold text-stone-700 ml-0.5">{deal.expectedRevenue}万</span>
                          </div>
                          <div className="border-l border-stone-200 pl-1.5">
                            <span className="text-stone-400">预计毛利:</span>
                            <span className="font-bold text-emerald-700 ml-0.5">+{deal.expectedProfit}万</span>
                          </div>
                        </div>

                        {/* Current Card Blocker text */}
                        {deal.currentBlocker && (
                          <div className="p-1.5 bg-rose-50 text-rose-800 rounded text-[11px] flex gap-1 items-start leading-normal">
                            <CircleAlert className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                            <span><b>卡点：</b>{deal.currentBlocker}</span>
                          </div>
                        )}

                        {/* Next action step */}
                        {deal.nextStep && (
                          <div className="p-1.5 bg-emerald-50/50 text-emerald-800 rounded text-[11px] flex gap-1 items-start leading-normal">
                            <CheckSquare className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                            <span><b>下一步：</b>{deal.nextStep}</span>
                          </div>
                        )}

                        <div className="flex items-center justify-between text-[10px] text-stone-400 pt-1 border-t border-stone-100 mt-1">
                          <span>买方: {deal.buyerName}</span>
                          <span className="flex items-center gap-0.5">
                            <Calendar className="w-3 h-3" />
                            {deal.deadline || "无截止日期"}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress & Blocker Modifier overlay modal */}
      <AnimatePresence>
        {activeDealEdit && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-lg overflow-hidden text-xs font-sans text-stone-800"
            >
              <div className="p-5 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-stone-900">
                    推进交易进度与跟进卡点修改
                  </h3>
                  <p className="text-[11px] text-stone-500 mt-0.5">{activeDealEdit.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveDealEdit(null)}
                  className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
                >
                  <XIcon className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Stage progression steps slider */}
                <div className="space-y-1.5">
                  <label className="font-bold text-stone-700 block">1. 推进当前交易流程环节：</label>
                  <select
                    className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-800 font-semibold"
                    value={activeDealEdit.stage}
                    onChange={(e) => onUpdateDealStage(activeDealEdit.id, e.target.value as DealStage)}
                  >
                    <option value={DealStage.CONTACT}>[商谈] 1. 初步接触</option>
                    <option value={DealStage.CONFIRM_DEMAND}>[商谈] 2. 需求确认</option>
                    <option value={DealStage.MATCH_STOCK}>[商谈] 3. 货源匹配</option>
                    <option value={DealStage.QUOTED}>[商谈] 4. 对外已报价</option>
                    <option value={DealStage.INTERESTED}>[商谈] 5. 买方买意强烈</option>
                    <option value={DealStage.LOCKED}>[保障] 6. 全款锁定底仓</option>
                    <option value={DealStage.INSPECTING}>[保障] 7. 机房实地核验中</option>
                    <option value={DealStage.CONTRACT}>[签约] 8. 双边合同流转</option>
                    <option value={DealStage.PAYING}>[签约] 9. 买家付定金/开LC</option>
                    <option value={DealStage.DELIVERING}>[履行] 10. 设备下架清关物流中</option>
                    <option value={DealStage.CLOSED_WON}>[结束] 11. 交付完成已结清尾款 🎉</option>
                    <option value={DealStage.CLOSED_LOST}>[结束] 12. 交易流产/已被绕单 ❌</option>
                  </select>
                </div>

                {/* Blocker details text edit */}
                <div className="space-y-1.5">
                  <label className="font-bold text-stone-700 block">2. 修改当前阻塞卡点：</label>
                  <textarea
                    rows={2}
                    className="w-full p-2.5 bg-stone-50 border border-stone-200 rounded-lg text-stone-800 leading-normal"
                    placeholder="请输入设备参数冲突、SN查询、资金流延迟、中介拼缝过桥等具体卡点问题，留空代表顺畅..."
                    value={blockerInput}
                    onChange={(e) => setBlockerInput(e.target.value)}
                  />
                </div>

                {/* Next step details text edit */}
                <div className="space-y-1.5">
                  <label className="font-bold text-stone-700 block">3. 明确下一步动作与责任人：</label>
                  <input
                    type="text"
                    className="w-full p-2.5 bg-stone-50 border border-stone-200 rounded-lg text-stone-800"
                    placeholder="例如：今日18:00前，联系马总提供BMC开机无红灯截图..."
                    value={nextStepInput}
                    onChange={(e) => setNextStepInput(e.target.value)}
                  />
                </div>

                {/* Danger bypass notice for intermediary trades */}
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-900 flex gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block mb-0.5">防中途绕单原则：</span>
                    <span>凡涉及多个外部居间中介拼缝的，切勿将真实货权SN直接发给最终买家，应在“机房验货”前签订三方佣金代付保障合同。</span>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-stone-200 bg-stone-50 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setActiveDealEdit(null)}
                  className="px-4 py-2 border border-stone-300 hover:bg-stone-200 text-stone-700 rounded-lg"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveAction}
                  className="px-5 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-semibold shadow-sm"
                >
                  保存跟进卡点
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
