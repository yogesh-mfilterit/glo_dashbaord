// app/components/SubscriptionFlowTable.tsx
import React from "react";

type RowType = {
  date: string;
  BannerDisplay: number;
  CTA1: number;
  CTA2: number;
  sdpSuccess: number;
  CallbackSuccess: number;
};

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "0";
  return value.toLocaleString("en-US");
}

export default function SubscriptionFlowTable({
  chartData,
}: {
  chartData: RowType[];
}) {
  const sortedData = chartData
    ? [...chartData].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      )
    : [];

  return (
    <div className="bg-white border rounded p-4 shadow">
      <div className="font-bold mb-2">Subscription Flow Analysis</div>

      {/* 🔥 SCROLL CONTAINER */}
      <div
        className="scrollbar-thin"
        style={{
          maxHeight: "300px",
          overflowY: "auto",
          overflowX: "auto",
        }}
      >
        {!sortedData || sortedData.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center text-gray-500">
            No data found
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
            }}
          >
            {/* 🔥 STICKY HEADER */}
            <thead>
              <tr>
                <th style={thSticky}>Date</th>
                <th style={thSticky}>Banner Display</th>
                <th style={thSticky}>CTA 1</th>
                <th style={thSticky}>CTA 2</th>
                <th style={thSticky}>SDP Success</th>
                <th style={thSticky}>Callback Success</th>
              </tr>
            </thead>

            <tbody>
              {sortedData.map((row, index) => (
                <tr key={index} style={index % 2 ? rowStyleAlt : rowStyle}>
                  <td style={tdCenter}>{row.date}</td>
                  <td style={tdRight}>{formatNumber(row.BannerDisplay)}</td>
                  <td style={tdRight}>{formatNumber(row.CTA1)}</td>
                  <td style={tdRight}>{formatNumber(row.CTA2)}</td>
                  <td style={tdRight}>{formatNumber(row.sdpSuccess)}</td>
                  <td style={tdRight}>{formatNumber(row.CallbackSuccess)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Scrollbar styles */}
      <style>
        {`
          .scrollbar-thin::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }
          .scrollbar-thin::-webkit-scrollbar-track {
            background: transparent;
          }
          .scrollbar-thin::-webkit-scrollbar-thumb {
            background-color: #d3d3d3;
            border-radius: 10px;
          }
          .scrollbar-thin::-webkit-scrollbar-thumb:hover {
            background-color: #b5b5b5;
          }
        `}
      </style>
    </div>
  );
}

/* ================= STYLES ================= */

const thSticky: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 10,
  background: "#f4f4f4",
  border: "1px solid #ccc",
  padding: "0.5rem",
  fontSize: "12px",
  fontWeight: "bold",
  textAlign: "center",
};

const tdRight: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: "0.5rem",
  fontSize: "12px",
  textAlign: "center",
};

const tdCenter: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: "0.5rem",
  fontSize: "12px",
  textAlign: "center",
  width: "70px",
};

const rowStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
};

const rowStyleAlt: React.CSSProperties = {
  backgroundColor: "#f9f9f9",
};
