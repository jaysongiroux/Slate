(function (React, designSystem, adminjs) {
  "use strict";

  function _interopDefault(e) {
    return e && e.__esModule ? e : { default: e };
  }

  var React__default = /*#__PURE__*/ _interopDefault(React);

  function StatCard({ label, value }) {
    return /*#__PURE__*/ React__default.default.createElement(
      designSystem.Box,
      {
        variant: "white",
        p: "xl",
        boxShadow: "card",
        style: {
          minWidth: "168px",
          flex: "1 1 160px",
        },
      },
      /*#__PURE__*/ React__default.default.createElement(
        designSystem.H5,
        {
          color: "grey60",
          fontWeight: "normal",
        },
        label,
      ),
      /*#__PURE__*/ React__default.default.createElement(
        designSystem.H2,
        {
          mt: "sm",
        },
        value,
      ),
    );
  }
  function boolLabel(v) {
    return v ? "Yes" : "No";
  }
  const Dashboard = () => {
    const [data, setData] = React.useState(null);
    const [error, setError] = React.useState(null);
    React.useEffect(() => {
      const api = new adminjs.ApiClient();
      void api
        .getDashboard()
        .then((res) => setData(res.data))
        .catch((err) => {
          const message = err instanceof Error ? err.message : "Failed to load dashboard";
          setError(message);
        });
    }, []);
    if (error) {
      return /*#__PURE__*/ React__default.default.createElement(
        designSystem.Box,
        {
          p: "xl",
        },
        /*#__PURE__*/ React__default.default.createElement(
          designSystem.Text,
          {
            color: "error",
          },
          error,
        ),
      );
    }
    if (!data) {
      return /*#__PURE__*/ React__default.default.createElement(
        designSystem.Box,
        {
          p: "xl",
        },
        /*#__PURE__*/ React__default.default.createElement(
          designSystem.Text,
          {
            color: "grey60",
          },
          "Loading\u2026",
        ),
      );
    }
    return /*#__PURE__*/ React__default.default.createElement(
      designSystem.Box,
      {
        px: "xl",
        py: "lg",
      },
      /*#__PURE__*/ React__default.default.createElement(
        designSystem.H2,
        {
          mb: "xl",
        },
        "Overview",
      ),
      /*#__PURE__*/ React__default.default.createElement(
        designSystem.H5,
        {
          mb: "default",
          color: "grey60",
        },
        "Platform",
      ),
      /*#__PURE__*/ React__default.default.createElement(
        designSystem.Box,
        {
          display: "flex",
          flexWrap: "wrap",
          gap: "lg",
          mb: "xxl",
        },
        /*#__PURE__*/ React__default.default.createElement(StatCard, {
          label: "Users",
          value: data.totalUsers,
        }),
        /*#__PURE__*/ React__default.default.createElement(StatCard, {
          label: "Admins",
          value: data.totalAdmins,
        }),
        /*#__PURE__*/ React__default.default.createElement(StatCard, {
          label: "Documents (not deleted)",
          value: data.totalDocuments,
        }),
        /*#__PURE__*/ React__default.default.createElement(StatCard, {
          label: "Attachments",
          value: data.totalAttachments,
        }),
        /*#__PURE__*/ React__default.default.createElement(StatCard, {
          label: "Account creation open",
          value: boolLabel(data.accountCreationEnabled),
        }),
        /*#__PURE__*/ React__default.default.createElement(StatCard, {
          label: "Password auth",
          value: boolLabel(data.passwordAuthEnabled),
        }),
        /*#__PURE__*/ React__default.default.createElement(StatCard, {
          label: "OIDC providers",
          value: `${data.oidcProvidersEnabledCount} / ${data.oidcProvidersCount}`,
        }),
      ),
      /*#__PURE__*/ React__default.default.createElement(
        designSystem.H5,
        {
          mb: "default",
          color: "grey60",
        },
        "Embeddings",
      ),
      /*#__PURE__*/ React__default.default.createElement(
        designSystem.Text,
        {
          mb: "lg",
          color: "grey60",
          fontSize: "sm",
        },
        "Queued counts include only documents for users who have both an embedding provider and model configured (same rules as the core embedding worker).",
      ),
      /*#__PURE__*/ React__default.default.createElement(
        designSystem.Box,
        {
          display: "flex",
          flexWrap: "wrap",
          gap: "lg",
        },
        /*#__PURE__*/ React__default.default.createElement(StatCard, {
          label: "Users with embedding configured",
          value: data.usersWithEmbeddingConfigured,
        }),
        /*#__PURE__*/ React__default.default.createElement(StatCard, {
          label: "Documents queued for embedding",
          value: data.documentsQueuedForEmbedding,
        }),
        /*#__PURE__*/ React__default.default.createElement(StatCard, {
          label: "Documents embedded (indexed)",
          value: data.documentsEmbeddedIndexed,
        }),
      ),
    );
  };

  function PlainText(props) {
    const label = props.property?.label ?? props.property?.name ?? "";
    const value = (props.record?.params?.[props.property?.name] ?? "").replace(/\n/g, "\\n");
    return /*#__PURE__*/ React__default.default.createElement(
      "div",
      {
        style: {
          marginBottom: "24px",
        },
      },
      /*#__PURE__*/ React__default.default.createElement(
        "p",
        {
          style: {
            color: "#898A9B",
            fontSize: "12px",
            fontWeight: 400,
            marginBottom: "4px",
          },
        },
        label,
      ),
      /*#__PURE__*/ React__default.default.createElement(
        "p",
        {
          style: {
            fontSize: "14px",
          },
        },
        value,
      ),
    );
  }

  AdminJS.UserComponents = {};
  AdminJS.UserComponents.Dashboard = Dashboard;
  AdminJS.UserComponents.PlainText = PlainText;
})(React, AdminJSDesignSystem, AdminJS);
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVuZGxlLmpzIiwic291cmNlcyI6WyIuLi9zcmMvY29tcG9uZW50cy9kYXNoYm9hcmQudHN4IiwiLi4vc3JjL2NvbXBvbmVudHMvcGxhaW4tdGV4dC50c3giLCJlbnRyeS5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgUmVhY3QsIHsgdXNlRWZmZWN0LCB1c2VTdGF0ZSB9IGZyb20gXCJyZWFjdFwiO1xuaW1wb3J0IHsgQm94LCBIMiwgSDUsIFRleHQgfSBmcm9tIFwiQGFkbWluanMvZGVzaWduLXN5c3RlbVwiO1xuaW1wb3J0IHsgQXBpQ2xpZW50IH0gZnJvbSBcImFkbWluanNcIjtcblxuZXhwb3J0IHR5cGUgU2xhdGVEYXNoYm9hcmRTdGF0cyA9IHtcbiAgdG90YWxVc2VyczogbnVtYmVyO1xuICB0b3RhbEFkbWluczogbnVtYmVyO1xuICB0b3RhbERvY3VtZW50czogbnVtYmVyO1xuICB0b3RhbEF0dGFjaG1lbnRzOiBudW1iZXI7XG4gIGFjY291bnRDcmVhdGlvbkVuYWJsZWQ6IGJvb2xlYW47XG4gIHBhc3N3b3JkQXV0aEVuYWJsZWQ6IGJvb2xlYW47XG4gIG9pZGNQcm92aWRlcnNDb3VudDogbnVtYmVyO1xuICBvaWRjUHJvdmlkZXJzRW5hYmxlZENvdW50OiBudW1iZXI7XG4gIHVzZXJzV2l0aEVtYmVkZGluZ0NvbmZpZ3VyZWQ6IG51bWJlcjtcbiAgZG9jdW1lbnRzUXVldWVkRm9yRW1iZWRkaW5nOiBudW1iZXI7XG4gIGRvY3VtZW50c0VtYmVkZGVkSW5kZXhlZDogbnVtYmVyO1xufTtcblxuZnVuY3Rpb24gU3RhdENhcmQoeyBsYWJlbCwgdmFsdWUgfTogeyBsYWJlbDogc3RyaW5nOyB2YWx1ZTogUmVhY3QuUmVhY3ROb2RlIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8Qm94IHZhcmlhbnQ9XCJ3aGl0ZVwiIHA9XCJ4bFwiIGJveFNoYWRvdz1cImNhcmRcIiBzdHlsZT17eyBtaW5XaWR0aDogXCIxNjhweFwiLCBmbGV4OiBcIjEgMSAxNjBweFwiIH19PlxuICAgICAgPEg1IGNvbG9yPVwiZ3JleTYwXCIgZm9udFdlaWdodD1cIm5vcm1hbFwiPlxuICAgICAgICB7bGFiZWx9XG4gICAgICA8L0g1PlxuICAgICAgPEgyIG10PVwic21cIj57dmFsdWV9PC9IMj5cbiAgICA8L0JveD5cbiAgKTtcbn1cblxuZnVuY3Rpb24gYm9vbExhYmVsKHY6IGJvb2xlYW4pIHtcbiAgcmV0dXJuIHYgPyBcIlllc1wiIDogXCJOb1wiO1xufVxuXG5jb25zdCBEYXNoYm9hcmQ6IFJlYWN0LkZDID0gKCkgPT4ge1xuICBjb25zdCBbZGF0YSwgc2V0RGF0YV0gPSB1c2VTdGF0ZTxTbGF0ZURhc2hib2FyZFN0YXRzIHwgbnVsbD4obnVsbCk7XG4gIGNvbnN0IFtlcnJvciwgc2V0RXJyb3JdID0gdXNlU3RhdGU8c3RyaW5nIHwgbnVsbD4obnVsbCk7XG5cbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBjb25zdCBhcGkgPSBuZXcgQXBpQ2xpZW50KCk7XG4gICAgdm9pZCBhcGlcbiAgICAgIC5nZXREYXNoYm9hcmQoKVxuICAgICAgLnRoZW4oKHJlcykgPT4gc2V0RGF0YShyZXMuZGF0YSBhcyBTbGF0ZURhc2hib2FyZFN0YXRzKSlcbiAgICAgIC5jYXRjaCgoZXJyOiB1bmtub3duKSA9PiB7XG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogXCJGYWlsZWQgdG8gbG9hZCBkYXNoYm9hcmRcIjtcbiAgICAgICAgc2V0RXJyb3IobWVzc2FnZSk7XG4gICAgICB9KTtcbiAgfSwgW10pO1xuXG4gIGlmIChlcnJvcikge1xuICAgIHJldHVybiAoXG4gICAgICA8Qm94IHA9XCJ4bFwiPlxuICAgICAgICA8VGV4dCBjb2xvcj1cImVycm9yXCI+e2Vycm9yfTwvVGV4dD5cbiAgICAgIDwvQm94PlxuICAgICk7XG4gIH1cblxuICBpZiAoIWRhdGEpIHtcbiAgICByZXR1cm4gKFxuICAgICAgPEJveCBwPVwieGxcIj5cbiAgICAgICAgPFRleHQgY29sb3I9XCJncmV5NjBcIj5Mb2FkaW5n4oCmPC9UZXh0PlxuICAgICAgPC9Cb3g+XG4gICAgKTtcbiAgfVxuXG4gIHJldHVybiAoXG4gICAgPEJveCBweD1cInhsXCIgcHk9XCJsZ1wiPlxuICAgICAgPEgyIG1iPVwieGxcIj5PdmVydmlldzwvSDI+XG5cbiAgICAgIDxINSBtYj1cImRlZmF1bHRcIiBjb2xvcj1cImdyZXk2MFwiPlxuICAgICAgICBQbGF0Zm9ybVxuICAgICAgPC9INT5cbiAgICAgIDxCb3ggZGlzcGxheT1cImZsZXhcIiBmbGV4V3JhcD1cIndyYXBcIiBnYXA9XCJsZ1wiIG1iPVwieHhsXCI+XG4gICAgICAgIDxTdGF0Q2FyZCBsYWJlbD1cIlVzZXJzXCIgdmFsdWU9e2RhdGEudG90YWxVc2Vyc30gLz5cbiAgICAgICAgPFN0YXRDYXJkIGxhYmVsPVwiQWRtaW5zXCIgdmFsdWU9e2RhdGEudG90YWxBZG1pbnN9IC8+XG4gICAgICAgIDxTdGF0Q2FyZCBsYWJlbD1cIkRvY3VtZW50cyAobm90IGRlbGV0ZWQpXCIgdmFsdWU9e2RhdGEudG90YWxEb2N1bWVudHN9IC8+XG4gICAgICAgIDxTdGF0Q2FyZCBsYWJlbD1cIkF0dGFjaG1lbnRzXCIgdmFsdWU9e2RhdGEudG90YWxBdHRhY2htZW50c30gLz5cbiAgICAgICAgPFN0YXRDYXJkIGxhYmVsPVwiQWNjb3VudCBjcmVhdGlvbiBvcGVuXCIgdmFsdWU9e2Jvb2xMYWJlbChkYXRhLmFjY291bnRDcmVhdGlvbkVuYWJsZWQpfSAvPlxuICAgICAgICA8U3RhdENhcmQgbGFiZWw9XCJQYXNzd29yZCBhdXRoXCIgdmFsdWU9e2Jvb2xMYWJlbChkYXRhLnBhc3N3b3JkQXV0aEVuYWJsZWQpfSAvPlxuICAgICAgICA8U3RhdENhcmRcbiAgICAgICAgICBsYWJlbD1cIk9JREMgcHJvdmlkZXJzXCJcbiAgICAgICAgICB2YWx1ZT17YCR7ZGF0YS5vaWRjUHJvdmlkZXJzRW5hYmxlZENvdW50fSAvICR7ZGF0YS5vaWRjUHJvdmlkZXJzQ291bnR9YH1cbiAgICAgICAgLz5cbiAgICAgIDwvQm94PlxuXG4gICAgICA8SDUgbWI9XCJkZWZhdWx0XCIgY29sb3I9XCJncmV5NjBcIj5cbiAgICAgICAgRW1iZWRkaW5nc1xuICAgICAgPC9INT5cbiAgICAgIDxUZXh0IG1iPVwibGdcIiBjb2xvcj1cImdyZXk2MFwiIGZvbnRTaXplPVwic21cIj5cbiAgICAgICAgUXVldWVkIGNvdW50cyBpbmNsdWRlIG9ubHkgZG9jdW1lbnRzIGZvciB1c2VycyB3aG8gaGF2ZSBib3RoIGFuIGVtYmVkZGluZyBwcm92aWRlciBhbmQgbW9kZWxcbiAgICAgICAgY29uZmlndXJlZCAoc2FtZSBydWxlcyBhcyB0aGUgY29yZSBlbWJlZGRpbmcgd29ya2VyKS5cbiAgICAgIDwvVGV4dD5cbiAgICAgIDxCb3ggZGlzcGxheT1cImZsZXhcIiBmbGV4V3JhcD1cIndyYXBcIiBnYXA9XCJsZ1wiPlxuICAgICAgICA8U3RhdENhcmRcbiAgICAgICAgICBsYWJlbD1cIlVzZXJzIHdpdGggZW1iZWRkaW5nIGNvbmZpZ3VyZWRcIlxuICAgICAgICAgIHZhbHVlPXtkYXRhLnVzZXJzV2l0aEVtYmVkZGluZ0NvbmZpZ3VyZWR9XG4gICAgICAgIC8+XG4gICAgICAgIDxTdGF0Q2FyZCBsYWJlbD1cIkRvY3VtZW50cyBxdWV1ZWQgZm9yIGVtYmVkZGluZ1wiIHZhbHVlPXtkYXRhLmRvY3VtZW50c1F1ZXVlZEZvckVtYmVkZGluZ30gLz5cbiAgICAgICAgPFN0YXRDYXJkIGxhYmVsPVwiRG9jdW1lbnRzIGVtYmVkZGVkIChpbmRleGVkKVwiIHZhbHVlPXtkYXRhLmRvY3VtZW50c0VtYmVkZGVkSW5kZXhlZH0gLz5cbiAgICAgIDwvQm94PlxuICAgIDwvQm94PlxuICApO1xufTtcblxuZXhwb3J0IGRlZmF1bHQgRGFzaGJvYXJkO1xuIiwiaW1wb3J0IFJlYWN0IGZyb20gXCJyZWFjdFwiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBQbGFpblRleHQocHJvcHM6IGFueSkge1xuICBjb25zdCBsYWJlbCA9IHByb3BzLnByb3BlcnR5Py5sYWJlbCA/PyBwcm9wcy5wcm9wZXJ0eT8ubmFtZSA/PyBcIlwiO1xuICBjb25zdCB2YWx1ZSA9IChwcm9wcy5yZWNvcmQ/LnBhcmFtcz8uW3Byb3BzLnByb3BlcnR5Py5uYW1lXSA/PyBcIlwiKS5yZXBsYWNlKC9cXG4vZywgXCJcXFxcblwiKTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IG1hcmdpbkJvdHRvbTogXCIyNHB4XCIgfX0+XG4gICAgICA8cCBzdHlsZT17eyBjb2xvcjogXCIjODk4QTlCXCIsIGZvbnRTaXplOiBcIjEycHhcIiwgZm9udFdlaWdodDogNDAwLCBtYXJnaW5Cb3R0b206IFwiNHB4XCIgfX0+XG4gICAgICAgIHtsYWJlbH1cbiAgICAgIDwvcD5cbiAgICAgIDxwIHN0eWxlPXt7IGZvbnRTaXplOiBcIjE0cHhcIiB9fT57dmFsdWV9PC9wPlxuICAgIDwvZGl2PlxuICApO1xufVxuIiwiQWRtaW5KUy5Vc2VyQ29tcG9uZW50cyA9IHt9XG5pbXBvcnQgRGFzaGJvYXJkIGZyb20gJy4uL3NyYy9jb21wb25lbnRzL2Rhc2hib2FyZCdcbkFkbWluSlMuVXNlckNvbXBvbmVudHMuRGFzaGJvYXJkID0gRGFzaGJvYXJkXG5pbXBvcnQgUGxhaW5UZXh0IGZyb20gJy4uL3NyYy9jb21wb25lbnRzL3BsYWluLXRleHQnXG5BZG1pbkpTLlVzZXJDb21wb25lbnRzLlBsYWluVGV4dCA9IFBsYWluVGV4dCJdLCJuYW1lcyI6WyJTdGF0Q2FyZCIsImxhYmVsIiwidmFsdWUiLCJSZWFjdCIsImNyZWF0ZUVsZW1lbnQiLCJCb3giLCJ2YXJpYW50IiwicCIsImJveFNoYWRvdyIsInN0eWxlIiwibWluV2lkdGgiLCJmbGV4IiwiSDUiLCJjb2xvciIsImZvbnRXZWlnaHQiLCJIMiIsIm10IiwiYm9vbExhYmVsIiwidiIsIkRhc2hib2FyZCIsImRhdGEiLCJzZXREYXRhIiwidXNlU3RhdGUiLCJlcnJvciIsInNldEVycm9yIiwidXNlRWZmZWN0IiwiYXBpIiwiQXBpQ2xpZW50IiwiZ2V0RGFzaGJvYXJkIiwidGhlbiIsInJlcyIsImNhdGNoIiwiZXJyIiwibWVzc2FnZSIsIkVycm9yIiwiVGV4dCIsInB4IiwicHkiLCJtYiIsImRpc3BsYXkiLCJmbGV4V3JhcCIsImdhcCIsInRvdGFsVXNlcnMiLCJ0b3RhbEFkbWlucyIsInRvdGFsRG9jdW1lbnRzIiwidG90YWxBdHRhY2htZW50cyIsImFjY291bnRDcmVhdGlvbkVuYWJsZWQiLCJwYXNzd29yZEF1dGhFbmFibGVkIiwib2lkY1Byb3ZpZGVyc0VuYWJsZWRDb3VudCIsIm9pZGNQcm92aWRlcnNDb3VudCIsImZvbnRTaXplIiwidXNlcnNXaXRoRW1iZWRkaW5nQ29uZmlndXJlZCIsImRvY3VtZW50c1F1ZXVlZEZvckVtYmVkZGluZyIsImRvY3VtZW50c0VtYmVkZGVkSW5kZXhlZCIsIlBsYWluVGV4dCIsInByb3BzIiwicHJvcGVydHkiLCJuYW1lIiwicmVjb3JkIiwicGFyYW1zIiwicmVwbGFjZSIsIm1hcmdpbkJvdHRvbSIsIkFkbWluSlMiLCJVc2VyQ29tcG9uZW50cyJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztFQWtCQSxTQUFTQSxRQUFRQSxDQUFDO0lBQUVDLEtBQUs7RUFBRUMsRUFBQUE7RUFBaUQsQ0FBQyxFQUFFO0VBQzdFLEVBQUEsb0JBQ0VDLHNCQUFBLENBQUFDLGFBQUEsQ0FBQ0MsZ0JBQUcsRUFBQTtFQUFDQyxJQUFBQSxPQUFPLEVBQUMsT0FBTztFQUFDQyxJQUFBQSxDQUFDLEVBQUMsSUFBSTtFQUFDQyxJQUFBQSxTQUFTLEVBQUMsTUFBTTtFQUFDQyxJQUFBQSxLQUFLLEVBQUU7RUFBRUMsTUFBQUEsUUFBUSxFQUFFLE9BQU87RUFBRUMsTUFBQUEsSUFBSSxFQUFFO0VBQVk7RUFBRSxHQUFBLGVBQzNGUixzQkFBQSxDQUFBQyxhQUFBLENBQUNRLGVBQUUsRUFBQTtFQUFDQyxJQUFBQSxLQUFLLEVBQUMsUUFBUTtFQUFDQyxJQUFBQSxVQUFVLEVBQUM7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
