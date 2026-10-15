using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using FOMS.Application.Interfaces;
using FOMS.Application.Features;
using FOMS.Domain.Entities;

using OfficialReceipt = FOMS.Domain.Entities.OfficialReceipt;

namespace FOMS.Application.Validators
{
    public static class ValidationHelpers
    {
        public static bool NotContainHtml(string? val)
        {
            if (string.IsNullOrEmpty(val)) return true;
            return !val.Contains("<script") && !val.Contains("javascript:") && !val.Contains("<html");
        }

        public static bool BeAValidDate(string? dateStr)
        {
            if (string.IsNullOrEmpty(dateStr)) return false;
            return DateTime.TryParse(dateStr, out _);
        }
    }



// ─────────────────────────────────────────────────────────────────────────────
// TASK 2 — PAYMENT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
public class RecordPaymentCommandValidator : AbstractValidator<PaymentFeatures.RecordPaymentCommand>
{
    private static readonly string[] AllowedPaymentMethods = new[] { "Card", "GCash", "Maya" };

    public RecordPaymentCommandValidator(IApplicationDbContext context)
    {
        RuleFor(x => x.Amount)
            .GreaterThan(0).WithMessage("Amount must be greater than zero.")
            .MustAsync(async (command, amount, cancellationToken) =>
            {
                var invoice = await context.Invoices.FirstOrDefaultAsync(i => i.Id == command.InvoiceId, cancellationToken);
                return invoice == null || amount <= invoice.Balance;
            }).WithMessage("Payment amount cannot exceed the outstanding invoice balance.");

        RuleFor(x => x.InvoiceId)
            .NotEmpty().WithMessage("Invoice ID is required.")
            .MustAsync(async (invoiceId, cancellationToken) =>
                await context.Invoices.AnyAsync(i => i.Id == invoiceId, cancellationToken))
            .WithMessage("Invoice does not exist.");

        RuleFor(x => x.ClientId)
            .NotEmpty().WithMessage("Client ID is required.")
            .MustAsync(async (clientId, cancellationToken) =>
            {
                // Accept CA- prefix or CL- prefix mapping
                var cleanId = clientId.StartsWith("CL-") ? clientId.Replace("CL-", "CA-") : clientId;
                return await context.Clients.AnyAsync(c => c.Id == cleanId || c.Id == clientId, cancellationToken);
            }).WithMessage("Client does not exist.");

        RuleFor(x => x.PaymentDate)
            .NotEmpty().WithMessage("Payment date is required.")
            .Must(ValidationHelpers.BeAValidDate).WithMessage("Payment date is not a valid date.");

        RuleFor(x => x.PaymentMethod)
            .NotEmpty().WithMessage("Payment method is required.")
            .Must(method => AllowedPaymentMethods.Contains(method))
            .WithMessage("Invalid payment method.");

        RuleFor(x => x.RecordedBy)
            .NotEmpty().WithMessage("Recorded by is required.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Recorded by field contains invalid characters.");

        RuleFor(x => x.OrNumber)
            .NotEmpty().WithMessage("OR Number is required.")
            .MaximumLength(50).WithMessage("OR Number cannot exceed 50 characters.")
            .MustAsync(async (orNo, cancellationToken) =>
                !await context.Payments.AnyAsync(p => p.OrNumber == orNo, cancellationToken))
            .WithMessage("OR Number must be unique.");

        RuleFor(x => x.ReferenceNumber)
            .MaximumLength(100).WithMessage("Reference number cannot exceed 100 characters.")
            .MustAsync(async (command, refNo, cancellationToken) =>
            {
                if (string.IsNullOrWhiteSpace(refNo)) return true;
                return !await context.Payments.AnyAsync(p => p.ReferenceNumber == refNo && p.InvoiceId == command.InvoiceId, cancellationToken);
            }).WithMessage("Reference number has already been used for this invoice.");

        RuleFor(x => x.Remarks)
            .MaximumLength(500).WithMessage("Remarks cannot exceed 500 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Remarks field contains invalid characters.");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 3 — INVOICE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
public class CreateInvoiceCommandValidator : AbstractValidator<InvoiceFeatures.CreateInvoiceCommand>
{
    public CreateInvoiceCommandValidator(IApplicationDbContext context)
    {
        RuleFor(x => x.InvoiceNo)
            .NotEmpty().WithMessage("Invoice Number is required.")
            .MaximumLength(50).WithMessage("Invoice Number cannot exceed 50 characters.")
            .MustAsync(async (invNo, cancellationToken) =>
                !await context.Invoices.AnyAsync(i => i.InvoiceNo == invNo, cancellationToken))
            .WithMessage("Invoice number must be unique.");

        RuleFor(x => x.ClientId)
            .NotEmpty().WithMessage("Client is required.")
            .MustAsync(async (clientId, cancellationToken) =>
            {
                var cleanId = clientId.StartsWith("CL-") ? clientId.Replace("CL-", "CA-") : clientId;
                return await context.Clients.AnyAsync(c => c.Id == cleanId || c.Id == clientId, cancellationToken);
            }).WithMessage("Client record does not exist.");

        RuleFor(x => x.FreightCharges)
            .GreaterThanOrEqualTo(0).WithMessage("Freight charges must be non-negative.");

        RuleFor(x => x.OtherCharges)
            .GreaterThanOrEqualTo(0).WithMessage("Other charges must be non-negative.");

        RuleFor(x => x.BillingDate)
            .NotEmpty().WithMessage("Billing date is required.")
            .Must(ValidationHelpers.BeAValidDate).WithMessage("Billing date is not a valid date.");

        RuleFor(x => x.DueDate)
            .NotEmpty().WithMessage("Due date is required.")
            .Must(ValidationHelpers.BeAValidDate).WithMessage("Due date is not a valid date.");

        RuleFor(x => x)
            .Must(x =>
            {
                if (DateTime.TryParse(x.BillingDate, out var billing) && DateTime.TryParse(x.DueDate, out var due))
                {
                    return due >= billing;
                }
                return false;
            })
            .WithName("DueDate")
            .WithMessage("Due Date must not be before Billing Date.");

        RuleFor(x => x.EncodedBy)
            .NotEmpty().WithMessage("Encoded by is required.")
            .MaximumLength(100).WithMessage("Encoded by cannot exceed 100 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Encoded by field contains invalid characters.");

        RuleFor(x => x.Description)
            .MaximumLength(500).WithMessage("Description cannot exceed 500 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Description contains invalid characters.");
    }
}

public class UpdateInvoiceCommandValidator : AbstractValidator<InvoiceFeatures.UpdateInvoiceCommand>
{
    public UpdateInvoiceCommandValidator(IApplicationDbContext context)
    {
        RuleFor(x => x.Id)
            .NotEmpty().WithMessage("Invoice ID is required.")
            .MustAsync(async (id, cancellationToken) =>
                await context.Invoices.AnyAsync(i => i.Id == id, cancellationToken))
            .WithMessage("Invoice record does not exist.");

        RuleFor(x => x.FreightCharges)
            .GreaterThanOrEqualTo(0).WithMessage("Freight charges must be non-negative.");

        RuleFor(x => x.OtherCharges)
            .GreaterThanOrEqualTo(0).WithMessage("Other charges must be non-negative.");

        RuleFor(x => x.BillingDate)
            .NotEmpty().WithMessage("Billing date is required.")
            .Must(ValidationHelpers.BeAValidDate).WithMessage("Billing date is not a valid date.");

        RuleFor(x => x.DueDate)
            .NotEmpty().WithMessage("Due date is required.")
            .Must(ValidationHelpers.BeAValidDate).WithMessage("Due date is not a valid date.");

        RuleFor(x => x)
            .Must(x =>
            {
                if (DateTime.TryParse(x.BillingDate, out var billing) && DateTime.TryParse(x.DueDate, out var due))
                {
                    return due >= billing;
                }
                return false;
            })
            .WithName("DueDate")
            .WithMessage("Due Date must not be before Billing Date.");

        RuleFor(x => x.UpdatedBy)
            .NotEmpty().WithMessage("Updated by is required.")
            .MaximumLength(100).WithMessage("Updated by cannot exceed 100 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Updated by contains invalid characters.");

        RuleFor(x => x.Description)
            .MaximumLength(500).WithMessage("Description cannot exceed 500 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Description contains invalid characters.");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 4 — ADJUSTMENT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
public class CreateAdjustmentCommandValidator : AbstractValidator<AdjustmentFeatures.CreateAdjustmentCommand>
{
    private static readonly string[] AllowedTypes = new[] { "Credit", "Debit", "Write-Off", "Credit Memo", "Adjustment" };

    public CreateAdjustmentCommandValidator(IApplicationDbContext context)
    {
        RuleFor(x => x.InvoiceNo)
            .NotEmpty().WithMessage("Invoice is required.")
            .MustAsync(async (invNo, cancellationToken) =>
                await context.Invoices.AnyAsync(i => i.InvoiceNo == invNo || i.Id == invNo, cancellationToken))
            .WithMessage("Invoice does not exist.");

        RuleFor(x => x.Amount)
            .GreaterThan(0).WithMessage("Adjustment amount must be greater than zero.");

        RuleFor(x => x.AdjustmentType)
            .NotEmpty().WithMessage("Adjustment type is required.")
            .Must(type => AllowedTypes.Any(t => t.Equals(type, StringComparison.OrdinalIgnoreCase)))
            .WithMessage("Invalid adjustment type. Allowed types: Credit, Debit, Write-Off, Credit Memo, Adjustment.");

        RuleFor(x => x.Reason)
            .NotEmpty().WithMessage("Reason is required.")
            .MinimumLength(10).WithMessage("Reason must be at least 10 characters.")
            .MaximumLength(1000).WithMessage("Reason cannot exceed 1000 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Reason contains invalid characters.");

        RuleFor(x => x.AdjustedBy)
            .MaximumLength(100).WithMessage("Adjusted by cannot exceed 100 characters.");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 5 — CLIENT ACCOUNT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
public class CreateClientCommandValidator : AbstractValidator<ClientFeatures.CreateClientCommand>
{
    public CreateClientCommandValidator(IApplicationDbContext context)
    {
        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("Client Name is required.")
            .MaximumLength(200).WithMessage("Client Name cannot exceed 200 characters.")
            .MustAsync(async (name, cancellationToken) =>
                !await context.Clients.AnyAsync(c => c.Name == name, cancellationToken))
            .WithMessage("A client with this name already exists.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Client Name contains invalid characters.");

        RuleFor(x => x.ClientCode)
            .NotEmpty().WithMessage("Client Code is required.")
            .MaximumLength(50).WithMessage("Client Code cannot exceed 50 characters.")
            .MustAsync(async (code, cancellationToken) =>
                !await context.Clients.AnyAsync(c => c.ClientCode == code, cancellationToken))
            .WithMessage("Client Code must be unique.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Client Code contains invalid characters.");

        RuleFor(x => x.ContactPerson)
            .NotEmpty().WithMessage("Contact information (Contact Person) is required.")
            .MaximumLength(100).WithMessage("Contact Person cannot exceed 100 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Contact Person contains invalid characters.");

        RuleFor(x => x.ContactNumber)
            .NotEmpty().WithMessage("Contact information (Contact Number) is required.")
            .MaximumLength(50).WithMessage("Contact Number cannot exceed 50 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Contact Number contains invalid characters.");

        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("Email is required.")
            .EmailAddress().WithMessage("Email format is invalid.")
            .MaximumLength(100).WithMessage("Email cannot exceed 100 characters.")
            .MustAsync(async (email, cancellationToken) =>
                !await context.Clients.AnyAsync(c => c.Email == email, cancellationToken))
            .WithMessage("A client with this email already exists.");

        RuleFor(x => x.BusinessName)
            .MaximumLength(200).WithMessage("Business Name cannot exceed 200 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Business Name contains invalid characters.");

        RuleFor(x => x.Address)
            .MaximumLength(500).WithMessage("Address cannot exceed 500 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Address contains invalid characters.");

        RuleFor(x => x.Tin)
            .MaximumLength(50).WithMessage("TIN cannot exceed 50 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("TIN contains invalid characters.");
    }
}

public class UpdateClientCommandValidator : AbstractValidator<ClientFeatures.UpdateClientCommand>
{
    public UpdateClientCommandValidator(IApplicationDbContext context)
    {
        RuleFor(x => x.Id)
            .NotEmpty().WithMessage("Client ID is required.")
            .MustAsync(async (id, cancellationToken) =>
                await context.Clients.AnyAsync(c => c.Id == id, cancellationToken))
            .WithMessage("Client does not exist.");

        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("Client Name is required.")
            .MaximumLength(200).WithMessage("Client Name cannot exceed 200 characters.")
            .MustAsync(async (command, name, cancellationToken) =>
                !await context.Clients.AnyAsync(c => c.Name == name && c.Id != command.Id, cancellationToken))
            .WithMessage("A client with this name already exists.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Client Name contains invalid characters.");

        RuleFor(x => x.ClientCode)
            .NotEmpty().WithMessage("Client Code is required.")
            .MaximumLength(50).WithMessage("Client Code cannot exceed 50 characters.")
            .MustAsync(async (command, code, cancellationToken) =>
                !await context.Clients.AnyAsync(c => c.ClientCode == code && c.Id != command.Id, cancellationToken))
            .WithMessage("Client Code must be unique.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Client Code contains invalid characters.");

        RuleFor(x => x.ContactPerson)
            .NotEmpty().WithMessage("Contact Person is required.")
            .MaximumLength(100).WithMessage("Contact Person cannot exceed 100 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Contact Person contains invalid characters.");

        RuleFor(x => x.ContactNumber)
            .NotEmpty().WithMessage("Contact Number is required.")
            .MaximumLength(50).WithMessage("Contact Number cannot exceed 50 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Contact Number contains invalid characters.");

        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("Email is required.")
            .EmailAddress().WithMessage("Email format is invalid.")
            .MaximumLength(100).WithMessage("Email cannot exceed 100 characters.")
            .MustAsync(async (command, email, cancellationToken) =>
                !await context.Clients.AnyAsync(c => c.Email == email && c.Id != command.Id, cancellationToken))
            .WithMessage("A client with this email already exists.");

        RuleFor(x => x.BusinessName)
            .MaximumLength(200).WithMessage("Business Name cannot exceed 200 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Business Name contains invalid characters.");

        RuleFor(x => x.Address)
            .MaximumLength(500).WithMessage("Address cannot exceed 500 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Address contains invalid characters.");

        RuleFor(x => x.Tin)
            .MaximumLength(50).WithMessage("TIN cannot exceed 50 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("TIN contains invalid characters.");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 6 — SPEEDPAY VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
public class InitiateSpeedPayCheckoutCommandValidator : AbstractValidator<SpeedPayFeatures.InitiateSpeedPayCheckoutCommand>
{
    public InitiateSpeedPayCheckoutCommandValidator(IApplicationDbContext context)
    {
        RuleFor(x => x.ShipmentId)
            .NotEmpty().WithMessage("Shipment ID is required.")
            .MustAsync(async (shipmentId, cancellationToken) =>
                await context.ShipmentRecords.AnyAsync(s => s.Id == shipmentId, cancellationToken))
            .WithMessage("Shipment record not found.");

        RuleFor(x => x.ClientId)
            .NotEmpty().WithMessage("Client ID is required.")
            .MustAsync(async (clientId, cancellationToken) =>
            {
                var cleanId = clientId.StartsWith("CL-") ? clientId.Replace("CL-", "CA-") : clientId;
                return await context.Clients.AnyAsync(c => c.Id == cleanId || c.Id == clientId, cancellationToken);
            }).WithMessage("Client account not found.");

        RuleFor(x => x.Amount)
            .GreaterThan(0).WithMessage("Amount must be greater than zero.")
            .MustAsync(async (command, amount, cancellationToken) =>
            {
                var cleanId = command.ClientId.StartsWith("CL-") ? command.ClientId.Replace("CL-", "CA-") : command.ClientId;
                var client = await context.Clients.FirstOrDefaultAsync(c => c.Id == cleanId, cancellationToken);
                var shipment = await context.ShipmentRecords.FirstOrDefaultAsync(s => s.Id == command.ShipmentId, cancellationToken);
                if (client == null || shipment == null) return true;
                
                var maxLimit = client.CurrentBalance + shipment.Cost;
                return amount <= maxLimit;
            }).WithMessage("Payment amount exceeds the client outstanding balance and shipment cost.");
    }
}

public class InitiateInvoiceCheckoutCommandValidator : AbstractValidator<SpeedPayFeatures.InitiateInvoiceCheckoutCommand>
{
    public InitiateInvoiceCheckoutCommandValidator(IApplicationDbContext context)
    {
        RuleFor(x => x.InvoiceNo)
            .NotEmpty().WithMessage("Invoice is required.")
            .MustAsync(async (invNo, cancellationToken) =>
                await context.Invoices.AnyAsync(i => i.InvoiceNo == invNo, cancellationToken))
            .WithMessage("Invoice not found. Please verify the invoice number.");

        RuleFor(x => x.Amount)
            .GreaterThan(0).WithMessage("Payment amount must be greater than zero.")
            .MustAsync(async (command, amount, cancellationToken) =>
            {
                var invoice = await context.Invoices.FirstOrDefaultAsync(i => i.InvoiceNo == command.InvoiceNo, cancellationToken);
                return invoice == null || amount <= invoice.Balance;
            }).WithMessage("Payment amount exceeds the outstanding invoice balance. Overpayments are not allowed.");
    }
}

public class ProcessSpeedPayWebhookCommandValidator : AbstractValidator<SpeedPayFeatures.ProcessSpeedPayWebhookCommand>
{
    public ProcessSpeedPayWebhookCommandValidator()
    {
        RuleFor(x => x.RawBody)
            .NotEmpty().WithMessage("Webhook payload cannot be empty.");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 7 — CASH FLOW VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
public class AddCashFlowCommandValidator : AbstractValidator<CashFlowFeatures.AddCashFlowCommand>
{
    private static readonly string[] AllowedTypes = new[] { "Inflow", "Outflow", "Cash Inflow", "Cash Outflow" };

    public AddCashFlowCommandValidator()
    {
        RuleFor(x => x.Amount)
            .GreaterThan(0).WithMessage("Cash flow amount must be greater than zero.");

        RuleFor(x => x.Type)
            .NotEmpty().WithMessage("Transaction Type is required.")
            .Must(type => AllowedTypes.Contains(type))
            .WithMessage("Cash flow Type must be either 'Inflow', 'Outflow', 'Cash Inflow' or 'Cash Outflow'.");

        RuleFor(x => x.ReferenceNo)
            .NotEmpty().WithMessage("Reference number is required for cash flow entries.")
            .MaximumLength(100).WithMessage("Reference number cannot exceed 100 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Reference number contains invalid characters.");

        RuleFor(x => x.AddedBy)
            .NotEmpty().WithMessage("User identity (AddedBy) is required.")
            .MaximumLength(100).WithMessage("AddedBy field cannot exceed 100 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("User identity contains invalid characters.");

        RuleFor(x => x.Category)
            .MaximumLength(100).WithMessage("Category cannot exceed 100 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Category contains invalid characters.");

        RuleFor(x => x.Description)
            .MaximumLength(500).WithMessage("Description cannot exceed 500 characters.")
            .Must(ValidationHelpers.NotContainHtml).WithMessage("Description contains invalid characters.");
    }
}

// Also support validating the entity CashFlowTransaction if passed directly in controllers
public class CashFlowTransactionValidator : AbstractValidator<CashFlowTransaction>
{
    private static readonly string[] AllowedTypes = new[] { "Inflow", "Outflow", "Cash Inflow", "Cash Outflow" };

    public CashFlowTransactionValidator()
    {
        RuleFor(x => x.Amount)
            .GreaterThan(0).WithMessage("Cash flow amount must be greater than zero.");

        RuleFor(x => x.Type)
            .NotEmpty().WithMessage("Transaction Type is required.")
            .Must(type => AllowedTypes.Contains(type))
            .WithMessage("Cash flow Type must be either 'Inflow', 'Outflow', 'Cash Inflow' or 'Cash Outflow'.");

        RuleFor(x => x.ReferenceNo)
            .NotEmpty().WithMessage("Reference number is required for cash flow entries.")
            .MaximumLength(100).WithMessage("Reference number cannot exceed 100 characters.");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 8 — OFFICIAL RECEIPT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
public class OfficialReceiptValidator : AbstractValidator<OfficialReceipt>
{
    public OfficialReceiptValidator(IApplicationDbContext context)
    {
        // Direct creation of OfficialReceipt is blocked because it must only be system-generated
        RuleFor(x => x)
            .Must(x => false)
            .WithMessage("Official Receipts can only be generated by the system, not manually created.");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 9 — PAYROLL VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
public class PayrollRecordValidator : AbstractValidator<PayrollRecord>
{
    public PayrollRecordValidator(IApplicationDbContext context)
    {
        RuleFor(x => x.EmployeeId)
            .NotEmpty().WithMessage("Employee ID is required.")
            .MustAsync(async (empId, cancellationToken) => 
                await context.Employees.AnyAsync(e => e.Id == empId, cancellationToken))
            .WithMessage("Employee record does not exist.");

        RuleFor(x => x.GrossPay)
            .GreaterThanOrEqualTo(0).WithMessage("Gross pay must be non-negative.");

        RuleFor(x => x.NetPay)
            .GreaterThanOrEqualTo(0).WithMessage("Net pay must be non-negative.");

        RuleFor(x => x.Deductions)
            .GreaterThanOrEqualTo(0).WithMessage("Deductions must be non-negative.");

        RuleFor(x => x.PayPeriodEnd)
            .GreaterThanOrEqualTo(x => x.PayPeriodStart)
            .WithMessage("Pay period end date must be on or after start date.");

        RuleForEach(x => x.DeductionLines)
            .SetValidator(new PayrollDeductionLineValidator());
    }
}

public class PayrollDeductionLineValidator : AbstractValidator<PayrollDeductionLine>
{
    private static readonly string[] AllowedDeductions = new[] { "SSS", "PhilHealth", "Pag-IBIG", "Withholding Tax" };

    public PayrollDeductionLineValidator()
    {
        RuleFor(x => x.DeductionType)
            .NotEmpty().WithMessage("Deduction type is required.")
            .Must(type => AllowedDeductions.Contains(type))
            .WithMessage("Invalid deduction category.");

        RuleFor(x => x.Amount)
            .GreaterThanOrEqualTo(0).WithMessage("Deduction amount must be non-negative.");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 10 — ENUM & STATUS VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
public class VerifyValidationCommandValidator : AbstractValidator<ValidationFeatures.VerifyValidationCommand>
{
    private static readonly string[] AllowedStatuses = new[] { "Pending", "Approved", "Rejected" };

    public VerifyValidationCommandValidator()
    {
        RuleFor(x => x.Id)
            .NotEmpty().WithMessage("Validation ID is required.");

        RuleFor(x => x.Status)
            .NotEmpty().WithMessage("Verification status is required.")
            .Must(status => AllowedStatuses.Contains(status))
            .WithMessage("Invalid verification status. Allowed statuses: Pending, Approved, Rejected.");
    }
}



}
