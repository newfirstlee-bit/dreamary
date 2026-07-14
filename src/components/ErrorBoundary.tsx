"use client";

import React from 'react';

export default class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorMsg: error.toString() + '\n' + error.stack };
  }
  render() {
    if (this.state.hasError) {
      return <div style={{padding: 20, color: 'red', wordBreak: 'break-all'}}><p>CRASH ERROR:</p><pre>{this.state.errorMsg}</pre></div>;
    }
    return this.props.children;
  }
}
