"use client";
import { useState } from "react";
import type { ExpenseTools } from "@/lib/expense-tools";
import { saveCategory, saveTemplate } from "@/app/groups/expense-actions";
import ActionForm from "./action-form";
export default function ExpenseCatalogManager({
  groupId,
  tools,
}: {
  groupId: string;
  tools: ExpenseTools;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const category = tools.categories.find((c) => c.id === categoryId);
  const template = tools.templates.find((t) => t.id === templateId);
  return (
    <details className="panel">
      <summary>Danh mục và mẫu thêm nhanh</summary>
      <h2>Danh mục khoản chi</h2>
      <label>
        Chọn danh mục để sửa
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Thêm danh mục mới</option>
          {tools.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {!c.active ? " · Ngừng dùng" : ""}
            </option>
          ))}
        </select>
      </label>
      <ActionForm
        key={`category-${categoryId}`}
        action={saveCategory}
        label="Lưu danh mục"
      >
        <input type="hidden" name="group_id" value={groupId} />
        <input type="hidden" name="target" value={categoryId} />
        <label>
          Tên danh mục
          <input
            name="name"
            defaultValue={category?.name || ""}
            required
            maxLength={80}
          />
        </label>
        <label>
          Biểu tượng
          <select name="icon" defaultValue={category?.icon || "other"}>
            <option value="water">Nước</option>
            <option value="ball">Cầu / bóng</option>
            <option value="gear">Dụng cụ</option>
            <option value="parking">Gửi xe</option>
            <option value="food">Ăn uống</option>
            <option value="discount">Giảm giá</option>
            <option value="other">Khác</option>
          </select>
        </label>
        <label>
          Thứ tự
          <input
            name="sort_order"
            type="number"
            min="0"
            max="1000"
            defaultValue={category?.sort_order ?? 10}
            required
          />
        </label>
        <label>
          <input
            type="checkbox"
            name="active"
            defaultChecked={category?.active ?? true}
          />{" "}
          Đang dùng
        </label>
        <label>
          Lý do
          <input name="reason" required maxLength={500} />
        </label>
      </ActionForm>
      <h2>Mẫu khoản hay lặp</h2>
      <label>
        Chọn mẫu để sửa
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          <option value="">Thêm mẫu mới</option>
          {tools.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
              {!t.active ? " · Ngừng dùng" : ""}
            </option>
          ))}
        </select>
      </label>
      <ActionForm
        key={`template-${templateId}`}
        action={saveTemplate}
        label="Lưu mẫu"
      >
        <input type="hidden" name="group_id" value={groupId} />
        <input type="hidden" name="target" value={templateId} />
        <label>
          Tên mẫu
          <input
            name="title"
            required
            maxLength={160}
            defaultValue={template?.title || ""}
          />
        </label>
        <label>
          Danh mục
          <select name="category_id" defaultValue={template?.category_id || ""}>
            <option value="">Không chọn</option>
            {tools.categories
              .filter((c) => c.active || c.id === template?.category_id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Số tiền (đ, số âm cho giảm giá)
          <input
            name="amount"
            required
            pattern="-?[0-9]+"
            defaultValue={template?.amount || ""}
          />
        </label>
        <label>
          Cách nhập
          <select name="mode" defaultValue={template?.mode || "per_person"}>
            <option value="total">Tổng tiền</option>
            <option value="per_person">Tiền mỗi người</option>
          </select>
        </label>
        <label>
          Cách chia
          <select name="split" defaultValue={template?.split || "equal"}>
            <option value="equal">Chia đều</option>
            <option value="weighted">Theo hệ số</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            name="active"
            defaultChecked={template?.active ?? true}
          />{" "}
          Đang dùng
        </label>
        <label>
          Lý do
          <input name="reason" required maxLength={500} />
        </label>
      </ActionForm>
    </details>
  );
}
